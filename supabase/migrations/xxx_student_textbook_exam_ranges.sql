-- student_textbook_exam_ranges (試験範囲)
-- 教科書 × 試験名 に対して curriculum_items の範囲 (start/end item_number) を持つ。
-- 試験目標 (student_textbook_exams) とは独立。目標がなくても範囲だけ設定可能。
CREATE TABLE IF NOT EXISTS student_textbook_exam_ranges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_textbook_id UUID NOT NULL REFERENCES student_textbooks(id) ON DELETE CASCADE,
  exam_type_id UUID NOT NULL REFERENCES exam_types(id) ON DELETE CASCADE,
  range_start_item_number INTEGER NOT NULL,
  range_end_item_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_textbook_id, exam_type_id),
  CHECK (range_start_item_number <= range_end_item_number)
);

DROP TRIGGER IF EXISTS update_student_textbook_exam_ranges_updated_at ON student_textbook_exam_ranges;
CREATE TRIGGER update_student_textbook_exam_ranges_updated_at
  BEFORE UPDATE ON student_textbook_exam_ranges
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_student_textbook_exam_ranges_textbook ON student_textbook_exam_ranges(student_textbook_id);
CREATE INDEX IF NOT EXISTS idx_student_textbook_exam_ranges_exam_type ON student_textbook_exam_ranges(exam_type_id);

ALTER TABLE student_textbook_exam_ranges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_textbook_exam_ranges_allow_all_auth" ON student_textbook_exam_ranges;
CREATE POLICY "student_textbook_exam_ranges_allow_all_auth" ON student_textbook_exam_ranges
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "student_textbook_exam_ranges_allow_all_anon" ON student_textbook_exam_ranges;
CREATE POLICY "student_textbook_exam_ranges_allow_all_anon" ON student_textbook_exam_ranges
  FOR ALL TO anon USING (true) WITH CHECK (true);
