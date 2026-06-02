-- 講習申込をコース依存から「期間(school + season) + 生徒」ベースへ。
-- 生徒別画面で「どの生徒がどの科目を何コマ」を直接入力できるよう、course_id を任意化し school_id/season を直接持つ。
ALTER TABLE koushu_enrollments ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES schools(id) ON DELETE CASCADE;
ALTER TABLE koushu_enrollments ADD COLUMN IF NOT EXISTS season text;

-- 既存行はコースから school_id / season をバックフィル
UPDATE koushu_enrollments ke
SET school_id = sc.school_id, season = sc.season
FROM seasonal_courses sc
WHERE sc.id = ke.course_id AND ke.school_id IS NULL;

-- course_id は任意（生徒別の直接申込は course_id なし）
ALTER TABLE koushu_enrollments ALTER COLUMN course_id DROP NOT NULL;

-- UNIQUE を (school_id, season, student_id, formation) に張り替え
ALTER TABLE koushu_enrollments DROP CONSTRAINT IF EXISTS koushu_enrollments_course_student_formation_key;
ALTER TABLE koushu_enrollments
  ADD CONSTRAINT koushu_enrollments_school_season_student_formation_key
  UNIQUE (school_id, season, student_id, formation);

CREATE INDEX IF NOT EXISTS idx_koushu_enrollments_school_season ON koushu_enrollments(school_id, season);
