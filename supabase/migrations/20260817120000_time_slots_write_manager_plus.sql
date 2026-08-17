-- schedule_time_slots の書き込みを manager 以上に限定する（セキュリティ改善）
--
-- 背景:
--  - 従来のポリシーは authenticated 全員に ALL（check_school_access のみ）で、
--    schedule_formations / school_formation_capacity（manager+ 限定）と非対称だった。
--    書き込みUIは /settings/time-slots（isManagerOrAbove ガード）のみで、
--    座席表・スケジュールボード等からの直書きは無いことを grep で確認済み。
--  - RPC reorder_time_slots / reassign_slot_numbers は SECURITY DEFINER かつ
--    ロール検査なしで anon にも EXECUTE が付いており、RLSを素通しできた。
--    さらに両関数は 20260525 の formation 対応で消えた旧制約名
--    schedule_time_slots_school_id_slot_number_key を SET CONSTRAINTS しており、
--    呼ぶと必ずエラーになる壊れた状態だった。ここで現行の制約名に合わせて直す。

BEGIN;

-- ── 1. 並び替えの中間状態を許すため、現行ユニーク制約を DEFERRABLE に張り替え ──
-- （旧 school_id_slot_number_key 時代は DEFERRABLE だったが、formation 対応の
--   張り替え時に外れていた。reorder_time_slots が SET CONSTRAINTS で使う前提条件）
ALTER TABLE public.schedule_time_slots
  DROP CONSTRAINT IF EXISTS schedule_time_slots_school_formation_slot_unique;
ALTER TABLE public.schedule_time_slots
  ADD CONSTRAINT schedule_time_slots_school_formation_slot_unique
  UNIQUE (school_id, formation, slot_number) DEFERRABLE INITIALLY IMMEDIATE;

-- ── 2. RLS: 参照は従来どおり教室スコープ、書き込みは manager+ に限定 ──
-- （schedule_formations / school_formation_capacity の write_manager と同型）
-- anon の SELECT ポリシー（is_active=true のみ）は保護者ポータルが使うため触らない。
DROP POLICY IF EXISTS "schedule_time_slots_school_scope_auth" ON public.schedule_time_slots;

DROP POLICY IF EXISTS schedule_time_slots_select_auth ON public.schedule_time_slots;
CREATE POLICY schedule_time_slots_select_auth ON public.schedule_time_slots
  FOR SELECT TO authenticated
  USING (public.check_school_access(school_id));

DROP POLICY IF EXISTS schedule_time_slots_write_manager ON public.schedule_time_slots;
CREATE POLICY schedule_time_slots_write_manager ON public.schedule_time_slots
  FOR ALL TO authenticated
  USING (
    public.check_school_access(school_id)
    AND EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager'))
  )
  WITH CHECK (
    public.check_school_access(school_id)
    AND EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager'))
  );

-- ── 3. reorder_time_slots を SECURITY INVOKER に変更し、現行制約名へ修正 ──
-- INVOKER 化により UPDATE は呼び出しユーザーの RLS（上の write_manager）を通る。
-- 明示ガードも置く: 権限外の呼び出しを「無言の0件更新」ではなくエラーにするため。
-- auth.role() が NULL（migration や psql 直接実行）や service_role のときはガードを通す。
CREATE OR REPLACE FUNCTION public.reorder_time_slots(p_school_id uuid, p_ordered_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.role() IN ('anon', 'authenticated') AND NOT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role IN ('admin', 'owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'コマ時間の並び替えは教室長以上のみ実行できます' USING ERRCODE = '42501';
  END IF;

  SET CONSTRAINTS schedule_time_slots_school_formation_slot_unique DEFERRED;

  UPDATE public.schedule_time_slots t
  SET slot_number = sub.new_number::integer,
      updated_at = now()
  FROM (
    SELECT id, ordinality AS new_number
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, ordinality)
  ) sub
  WHERE t.id = sub.id
    AND t.school_id = p_school_id
    AND t.slot_number IS DISTINCT FROM sub.new_number::integer;

  SET CONSTRAINTS schedule_time_slots_school_formation_slot_unique IMMEDIATE;
END;
$$;

-- ── 4. EXECUTE 権限の締め付け ──
-- 落とし穴「Supabase既定権限でanon/authenticatedにALLが付く」対応。
-- reassign_slot_numbers はアプリから未使用のレガシーだが、zzz_ の search_path 固定
-- マイグレーションが ALTER FUNCTION で参照するため DROP はせず権限だけ剥がす
-- （本体は旧制約名参照のままなので呼んでもエラーで実害なし。整理は別途）。
REVOKE ALL ON FUNCTION public.reorder_time_slots(p_school_id uuid, p_ordered_ids uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reassign_slot_numbers(p_school_id uuid) FROM PUBLIC, anon;

-- テーブル側も anon の書き込み権限を剥がす（RLS頼みをやめる。SELECT はポータル用に残す）
REVOKE INSERT, UPDATE, DELETE ON TABLE public.schedule_time_slots FROM anon;

COMMIT;
