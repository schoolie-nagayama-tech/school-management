-- seasonal_courses に講習期間（start_date / end_date）を追加
ALTER TABLE seasonal_courses
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE;

-- 講習申し込みテーブル（座席表連携用: コマ数 + 科目）
-- seasonal_course_applications とは別の「座席表用」の申し込み管理テーブル
CREATE TABLE IF NOT EXISTS koushu_enrollments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   UUID NOT NULL REFERENCES seasonal_courses(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  koma_count  INTEGER NOT NULL DEFAULT 0,
  subject_ids UUID[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(course_id, student_id)
);

ALTER TABLE koushu_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can manage koushu_enrollments"
  ON koushu_enrollments FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_koushu_enrollments_course   ON koushu_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_koushu_enrollments_student  ON koushu_enrollments(student_id);
