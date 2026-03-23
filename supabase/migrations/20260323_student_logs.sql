-- student_logs テーブル（生徒情報の変更履歴）
CREATE TABLE IF NOT EXISTS student_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'soft_deleted', 'restored', 'status_changed')),
  actor uuid DEFAULT NULL,
  diff jsonb DEFAULT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_student_logs_student_id ON student_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_student_logs_school_id ON student_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_student_logs_created_at ON student_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_logs_action ON student_logs(action);

-- RLS
ALTER TABLE student_logs ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーはinsert/select可能
CREATE POLICY "student_logs_select_authenticated"
  ON student_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "student_logs_insert_authenticated"
  ON student_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);
