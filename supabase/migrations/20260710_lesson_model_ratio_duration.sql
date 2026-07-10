-- Phase R: 個別指導の授業モデル拡張（1対1/1対2・45分半コマ）
--
-- 目的:
--   1. 通塾日程(schedule_regular_patterns)と座席表(schedule_entries)に
--      「指導比率(ratio) / 授業時間(duration_minutes) / 前後半(half_position)」を持たせる。
--   2. 生徒×科目の契約(1対1/1対2)を保持する student_subject_contracts を新設。
--
-- 設計判断（既存 student_subjects を拡張しなかった理由）:
--   既存の student_subjects(student_id, subject_id) は「受講科目リスト」であり、
--   setStudentSubjects() が編集のたびに delete-all → re-insert する破壊的置換で維持している。
--   さらに学年カテゴリ変更時にも一括削除される。ここに ratio を載せると編集のたびに
--   契約(比率)が失われる。指導比率は「受講しているか」とは別軸のスケジューリング契約なので、
--   専用テーブル student_subject_contracts に分離する（計画書 §2.8a の想定どおり）。
--
-- 挙動不変の保証:
--   既存行はすべて DEFAULT で ratio=2（1対2） / duration_minutes NULL（=コマ時間どおり90分扱い）
--   / half_position NULL（=全コマ）となり、Phase R 以前とまったく同じ意味になる。
--
-- ロールバック（レビューで差し戻す場合）:
--   ALTER TABLE public.schedule_regular_patterns
--     DROP COLUMN IF EXISTS ratio,
--     DROP COLUMN IF EXISTS duration_minutes,
--     DROP COLUMN IF EXISTS half_position;
--   ALTER TABLE public.schedule_entries
--     DROP COLUMN IF EXISTS ratio,
--     DROP COLUMN IF EXISTS duration_minutes,
--     DROP COLUMN IF EXISTS half_position;
--   DROP TABLE IF EXISTS public.student_subject_contracts;

-- ============================================================
-- 1. schedule_regular_patterns に3列追加
-- ============================================================
ALTER TABLE public.schedule_regular_patterns
  -- 指導比率: 1=1対1（生徒1名で満席） / 2=1対2（既定）。
  ADD COLUMN IF NOT EXISTS ratio smallint NOT NULL DEFAULT 2
    CHECK (ratio IN (1, 2)),
  -- 授業時間(分): 45 or 90。NULL=コマ時間どおり（実質90分の全コマ）扱い。
  ADD COLUMN IF NOT EXISTS duration_minutes integer
    CHECK (duration_minutes IS NULL OR duration_minutes IN (45, 90)),
  -- 45分授業の占有半コマ: 'first'=前半 / 'second'=後半 / NULL=全コマ。
  ADD COLUMN IF NOT EXISTS half_position text
    CHECK (half_position IS NULL OR half_position IN ('first', 'second'));

COMMENT ON COLUMN public.schedule_regular_patterns.ratio IS
  '指導比率: 1=1対1（生徒1名で満席） / 2=1対2。既定2。生徒×科目契約(student_subject_contracts)由来。';
COMMENT ON COLUMN public.schedule_regular_patterns.duration_minutes IS
  '授業時間(分): 45 or 90。subjects.duration_minutes のスナップショット。NULL=全コマ(90分)扱い。';
COMMENT ON COLUMN public.schedule_regular_patterns.half_position IS
  '45分授業の占有半コマ: first=前半 / second=後半 / NULL=全コマ。半コマ占有モデルの席計算に使う。';

-- ============================================================
-- 2. schedule_entries に同3列追加（パターンからのスナップショット継承先）
-- ============================================================
ALTER TABLE public.schedule_entries
  ADD COLUMN IF NOT EXISTS ratio smallint NOT NULL DEFAULT 2
    CHECK (ratio IN (1, 2)),
  ADD COLUMN IF NOT EXISTS duration_minutes integer
    CHECK (duration_minutes IS NULL OR duration_minutes IN (45, 90)),
  ADD COLUMN IF NOT EXISTS half_position text
    CHECK (half_position IS NULL OR half_position IN ('first', 'second'));

COMMENT ON COLUMN public.schedule_entries.ratio IS
  '指導比率: 1=1対1 / 2=1対2。パターンからスナップショット継承。既定2で既存挙動不変。';
COMMENT ON COLUMN public.schedule_entries.duration_minutes IS
  '授業時間(分): 45 or 90。パターン/科目からスナップショット継承。NULL=全コマ扱い。';
COMMENT ON COLUMN public.schedule_entries.half_position IS
  '45分授業の占有半コマ: first / second / NULL=全コマ。半コマ占有モデルの席計算に使う。';

-- ============================================================
-- 3. 生徒×科目の指導契約テーブル
-- ============================================================
-- student_id × subject_id → ratio(1|2)。1生徒が科目ごとに比率を変えられる。
-- school_id は RLS(check_school_access)と一覧クエリの高速化のために保持。
-- 生徒の所属校はアプリ側でセットする（生徒所属校を強制するトリガーは重いので付けない。
-- 所持教材の school_id 不変トリガーと違い、契約は移籍が稀で読み取り主体のため軽量運用で足りる）。
CREATE TABLE IF NOT EXISTS public.student_subject_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  -- 指導比率: 1=1対1 / 2=1対2（既定）。
  ratio smallint NOT NULL DEFAULT 2 CHECK (ratio IN (1, 2)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_student_subject_contracts_student
  ON public.student_subject_contracts USING btree (student_id);
CREATE INDEX IF NOT EXISTS idx_student_subject_contracts_school
  ON public.student_subject_contracts USING btree (school_id);

COMMENT ON TABLE public.student_subject_contracts IS
  '生徒×科目の指導契約(1対1/1対2)。通塾日程・座席表の ratio 初期値の正のソース。';

ALTER TABLE public.student_subject_contracts ENABLE ROW LEVEL SECURITY;

-- 読み取り/書き込みとも check_school_access(school_id) 流儀（school_widget_settings と同型）。
-- 講師含む authenticated が自校スコープで参照・編集でき、anon は遮断される。
DROP POLICY IF EXISTS "student_subject_contracts_school_scope_auth"
  ON public.student_subject_contracts;
CREATE POLICY "student_subject_contracts_school_scope_auth"
  ON public.student_subject_contracts FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

GRANT ALL ON TABLE public.student_subject_contracts TO authenticated;
GRANT ALL ON TABLE public.student_subject_contracts TO service_role;
