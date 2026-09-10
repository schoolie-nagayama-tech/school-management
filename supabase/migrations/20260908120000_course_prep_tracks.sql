-- 講習期間の「区分」（中学受験・高校受験・大学受験など）と、生徒の当てはめ。
--
-- 背景: 冬期は生徒によって講習期間が違う。当初は学年別終了日
--       （course_prep_periods.schedule_end_by_grade）で表そうとしたが、
--       同じ小6でも受験する子としない子がいるため学年では割れない。
--       そこで「区分」を期ごとに作り、そこに生徒を当てはめる形にする。
--
-- 当てはめの決まり:
--   1. course_prep_student_tracks に行があれば、それが正典（track_id が NULL なら「共通」に戻す上書き）
--   2. 行が無ければ、default_grades にその生徒の学年を含む区分（sort_order の若い順で最初の1件）
--   3. どれにも当たらなければ共通の講習期間
--   → 中3は既定学年で一括、小6の受験生だけ個別に当てはめる、という運用ができる。
--
-- 正典: docs/koushu-progress-snapshot-plan.md Phase 8

CREATE TABLE IF NOT EXISTS course_prep_tracks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  season              text NOT NULL,
  year                integer NOT NULL,
  name                text NOT NULL,
  -- 進捗表の行に出す短い名前。空なら name の先頭2文字を使う。
  short_name          text,
  -- NULL なら共通の開始日（course_prep_periods.schedule_start_date）を使う。
  schedule_start_date date,
  -- 区分を作る目的そのものなので必須。
  schedule_end_date   date NOT NULL,
  -- 既定で当てはめる学年（1〜13）。空配列なら個別の当てはめだけが効く。
  default_grades      integer[] NOT NULL DEFAULT '{}',
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_prep_tracks_unique_name UNIQUE (school_id, season, year, name),
  CONSTRAINT course_prep_tracks_range_check
    CHECK (schedule_start_date IS NULL OR schedule_end_date >= schedule_start_date)
);

CREATE INDEX IF NOT EXISTS idx_course_prep_tracks_period
  ON course_prep_tracks (school_id, season, year, sort_order);

CREATE TABLE IF NOT EXISTS course_prep_student_tracks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  season     text NOT NULL,
  year       integer NOT NULL,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  -- NULL は「既定の当てはめを打ち消して共通に戻す」という明示的な指定。
  -- 行が無い（未指定）状態とは意味が違うので、NULL を許す。
  track_id   uuid REFERENCES course_prep_tracks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_prep_student_tracks_unique UNIQUE (school_id, season, year, student_id)
);

CREATE INDEX IF NOT EXISTS idx_course_prep_student_tracks_period
  ON course_prep_student_tracks (school_id, season, year);

DROP TRIGGER IF EXISTS trg_course_prep_tracks_updated_at ON course_prep_tracks;
CREATE TRIGGER trg_course_prep_tracks_updated_at
  BEFORE UPDATE ON course_prep_tracks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_course_prep_student_tracks_updated_at ON course_prep_student_tracks;
CREATE TRIGGER trg_course_prep_student_tracks_updated_at
  BEFORE UPDATE ON course_prep_student_tracks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: 兄弟の course_prep_* と同じく check_school_access() に揃える。
ALTER TABLE course_prep_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_prep_student_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prep_tracks_select ON course_prep_tracks;
DROP POLICY IF EXISTS prep_tracks_insert ON course_prep_tracks;
DROP POLICY IF EXISTS prep_tracks_update ON course_prep_tracks;
DROP POLICY IF EXISTS prep_tracks_delete ON course_prep_tracks;
CREATE POLICY prep_tracks_select ON course_prep_tracks FOR SELECT USING (check_school_access(school_id));
CREATE POLICY prep_tracks_insert ON course_prep_tracks FOR INSERT WITH CHECK (check_school_access(school_id));
CREATE POLICY prep_tracks_update ON course_prep_tracks FOR UPDATE USING (check_school_access(school_id)) WITH CHECK (check_school_access(school_id));
CREATE POLICY prep_tracks_delete ON course_prep_tracks FOR DELETE USING (check_school_access(school_id));

DROP POLICY IF EXISTS prep_student_tracks_select ON course_prep_student_tracks;
DROP POLICY IF EXISTS prep_student_tracks_insert ON course_prep_student_tracks;
DROP POLICY IF EXISTS prep_student_tracks_update ON course_prep_student_tracks;
DROP POLICY IF EXISTS prep_student_tracks_delete ON course_prep_student_tracks;
CREATE POLICY prep_student_tracks_select ON course_prep_student_tracks FOR SELECT USING (check_school_access(school_id));
CREATE POLICY prep_student_tracks_insert ON course_prep_student_tracks FOR INSERT WITH CHECK (check_school_access(school_id));
CREATE POLICY prep_student_tracks_update ON course_prep_student_tracks FOR UPDATE USING (check_school_access(school_id)) WITH CHECK (check_school_access(school_id));
CREATE POLICY prep_student_tracks_delete ON course_prep_student_tracks FOR DELETE USING (check_school_access(school_id));

-- 既定権限で anon/authenticated に ALL が付くため、明示的に revoke してから付け直す。
REVOKE ALL ON course_prep_tracks FROM anon;
REVOKE ALL ON course_prep_tracks FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON course_prep_tracks TO authenticated;

REVOKE ALL ON course_prep_student_tracks FROM anon;
REVOKE ALL ON course_prep_student_tracks FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON course_prep_student_tracks TO authenticated;
