-- ============================================================================
-- コマ時間（schedule_time_slots）並び替えRPCの修正
--
-- 背景:
--   reorder_time_slots(uuid, uuid[]) は関数内で
--   `SET CONSTRAINTS schedule_time_slots_school_id_slot_number_key DEFERRED;`
--   という古い制約名を参照しているが、この制約は既に
--   schedule_time_slots_school_formation_slot_unique
--   （school_id, formation, slot_number の複合UNIQUE）に張り替え済みで、
--   参照先の名前は存在しない。そのため本RPCは呼び出す度に
--   42704 (undefined_object) で必ず失敗しており、
--     (a) /settings/time-slots のコマ並び替え（上下ボタン）が常に失敗する
--     (b) コマ削除後の欠番詰め直し（page.tsx側）が例外を投げ、
--         「削除自体は成功したのにエラートーストが出る」という体験になる
--   という2つの不具合を引き起こしていた。
--
--   加えて、張り替え後の制約には DEFERRABLE が付いていない。制約名を
--   直すだけでは、2件の slot_number を入れ替えるような更新が
--   トランザクション途中で一意制約違反になる。
--
--   このマイグレーションでは:
--   1) UNIQUE制約を DEFERRABLE INITIALLY IMMEDIATE に張り替える
--      （関数内で SET CONSTRAINTS ... DEFERRED し、コミット直前まで
--       チェックを遅延させられるようにするため）
--   2) slot_number の CHECK 上限を 7 → 20 に緩和する
--      （1〜7限の隠れ上限が「8コマ目追加で原因不明のエラー」の正体だった）
--   3) reorder_time_slots のシグネチャを
--      (p_school_id, p_ordered_ids uuid[]) から
--      (p_school_id, p_formation) に変更する。
--      新シグネチャは school_id × formation スコープで
--      display_order → slot_number の順にソートし、slot_number を
--      1..N の連番へ詰め直す。呼び出し側（並び替えの上下ボタン）は、
--      本RPCを呼ぶ前に対象コマの display_order へ新しい表示順を
--      書き込んでおく（updateTimeSlot 経由。display_order には一意制約が
--      無いため個別更新で衝突しない）。削除後の欠番詰めは
--      display_order を変更せず本RPCを呼ぶだけでよい
--      （残った行どうしの相対順序は変わらないため）。
--      形態をスコープに含めることで、他形態のコマ番号を巻き込んで
--      誤って詰め直してしまう事故も構造的に防げる。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. slot_number の UNIQUE 制約を DEFERRABLE に張り替え
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."schedule_time_slots"
  DROP CONSTRAINT IF EXISTS "schedule_time_slots_school_formation_slot_unique";

ALTER TABLE "public"."schedule_time_slots"
  ADD CONSTRAINT "schedule_time_slots_school_formation_slot_unique"
  UNIQUE ("school_id", "formation", "slot_number")
  DEFERRABLE INITIALLY IMMEDIATE;

-- ----------------------------------------------------------------------------
-- 2. slot_number の上限を 1〜7 → 1〜20 に緩和
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."schedule_time_slots"
  DROP CONSTRAINT IF EXISTS "schedule_time_slots_slot_number_check";

ALTER TABLE "public"."schedule_time_slots"
  ADD CONSTRAINT "schedule_time_slots_slot_number_check"
  CHECK ((("slot_number" >= 1) AND ("slot_number" <= 20)));

-- ----------------------------------------------------------------------------
-- 3. 旧 reorder_time_slots(uuid, uuid[]) を廃止
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS "public"."reorder_time_slots"("p_school_id" "uuid", "p_ordered_ids" "uuid"[]);

-- ----------------------------------------------------------------------------
-- 4. 新 reorder_time_slots(p_school_id, p_formation)
--    school_id × formation スコープで display_order → slot_number の順に
--    並べ、slot_number を 1..N の連番に詰め直す。
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."reorder_time_slots"("p_school_id" "uuid", "p_formation" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- 入れ替え対象の2件が一時的に同じ slot_number になる瞬間があるため、
  -- コミット直前（関数末尾のIMMEDIATE指定時、または関数終了時）まで
  -- UNIQUE制約のチェックを遅延させる。
  SET CONSTRAINTS "schedule_time_slots_school_formation_slot_unique" DEFERRED;

  UPDATE public.schedule_time_slots t
  SET slot_number = sub.new_number::integer,
      updated_at = now()
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY display_order ASC, slot_number ASC) AS new_number
    FROM public.schedule_time_slots
    WHERE school_id = p_school_id
      AND formation = p_formation
  ) sub
  WHERE t.id = sub.id
    AND t.slot_number IS DISTINCT FROM sub.new_number::integer;

  SET CONSTRAINTS "schedule_time_slots_school_formation_slot_unique" IMMEDIATE;
END;
$$;

ALTER FUNCTION "public"."reorder_time_slots"("p_school_id" "uuid", "p_formation" "text") OWNER TO "postgres";

-- 旧関数と同じ権限セットを踏襲する（anon/authenticated/service_role にALL付与）
GRANT ALL ON FUNCTION "public"."reorder_time_slots"("p_school_id" "uuid", "p_formation" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reorder_time_slots"("p_school_id" "uuid", "p_formation" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_time_slots"("p_school_id" "uuid", "p_formation" "text") TO "service_role";
