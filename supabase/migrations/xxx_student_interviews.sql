-- 面談記録テーブル作成
CREATE TABLE IF NOT EXISTS student_interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  interview_date DATE NOT NULL,
  interview_type TEXT NOT NULL CHECK (interview_type IN (
    'parent_interview', 'phone', 'student_interview', 'casual', 'enrollment', 'other', 'task'
  )),
  content TEXT NOT NULL,
  is_completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_student_interviews_student_id 
  ON student_interviews(student_id);
CREATE INDEX IF NOT EXISTS idx_student_interviews_school_id 
  ON student_interviews(school_id);
CREATE INDEX IF NOT EXISTS idx_student_interviews_date 
  ON student_interviews(interview_date DESC);

-- RLS
ALTER TABLE student_interviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all access for all users" ON student_interviews
  FOR ALL USING (true) WITH CHECK (true);
