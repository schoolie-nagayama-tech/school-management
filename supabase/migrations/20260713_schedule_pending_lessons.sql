-- P2改訂（2026-07-13）: 授業追加の「未消化プール」テーブル
--
-- 目的:
--   「授業を追加」でコマ数を指定して配置する途中で「完了」した場合、残りのコマ数を
--   このプールに退避し、後から「配置」で再開できるようにする（振替の保留プールと並ぶ導線）。
--
-- 設計:
--   - 1行 = 1対象者×1科目×1種別の未消化コマ束（remaining_count 本の未配置コマ）。
--   - 対象者は既存生徒(student_id) か 見込み客(inquiry_id) のどちらか一方（XOR）。
--     体験の見込み客は students に仮レコードを作らない方針（schedule_entries.inquiry_id と同型）。
--   - 配置するたびに remaining_count を1減らし、0になったら行を削除する（アプリ側 decrementOrDelete）。
--   - ratio / duration_minutes / half_position は配置時に schedule_entries へ引き継ぐスナップショット。
--
-- 挙動不変の保証:
--   新設テーブルのみ。既存テーブル・既存機能には一切触れない。
--
-- ロールバック（レビューで差し戻す場合）:
--   DROP TABLE IF EXISTS public.schedule_pending_lessons;

CREATE TABLE IF NOT EXISTS public.schedule_pending_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  -- 対象者は生徒 or 見込み客のどちらか一方（下の CHECK で XOR を強制）。
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  inquiry_id uuid REFERENCES public.inquiries(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  -- 授業種別: additional=追加授業 / trial=体験授業。
  kind text NOT NULL CHECK (kind IN ('additional', 'trial')),
  -- 指導比率: 1=1対1 / 2=1対2（既定）。座席表エントリへスナップショット継承。
  ratio smallint NOT NULL DEFAULT 2 CHECK (ratio IN (1, 2)),
  -- 授業時間(分): 45 or 90。NULL=全コマ(90分)扱い。
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes IN (45, 90)),
  -- 45分授業の占有半コマ: first / second / NULL=全コマ。
  half_position text CHECK (half_position IS NULL OR half_position IN ('first', 'second')),
  -- 残りの未配置コマ数（>0）。0 になったらアプリ側で行削除する。
  remaining_count integer NOT NULL CHECK (remaining_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 対象者は生徒 or 見込み客のどちらか一方だけ（schedule_entries の XOR と同型）。
  CONSTRAINT schedule_pending_lessons_target_xor CHECK (
    (student_id IS NOT NULL AND inquiry_id IS NULL)
    OR (student_id IS NULL AND inquiry_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_schedule_pending_lessons_school
  ON public.schedule_pending_lessons USING btree (school_id);

COMMENT ON TABLE public.schedule_pending_lessons IS
  '授業追加の未消化プール。コマ数指定配置の途中終了で残数を退避し、後から配置で再開する。';

ALTER TABLE public.schedule_pending_lessons ENABLE ROW LEVEL SECURITY;

-- 読み取り/書き込みとも check_school_access(school_id) 流儀（student_subject_contracts と同型）。
-- 講師含む authenticated が自校スコープで参照・編集でき、anon は遮断される。
DROP POLICY IF EXISTS "schedule_pending_lessons_school_scope_auth"
  ON public.schedule_pending_lessons;
CREATE POLICY "schedule_pending_lessons_school_scope_auth"
  ON public.schedule_pending_lessons FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

GRANT ALL ON TABLE public.schedule_pending_lessons TO authenticated;
GRANT ALL ON TABLE public.schedule_pending_lessons TO service_role;
