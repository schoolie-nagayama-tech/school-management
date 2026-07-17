-- ============================================
-- progress_sessions: セッション単位の指導記録
-- 1コマ(90分) = 1セッション = 1レコード
-- ============================================

CREATE TABLE IF NOT EXISTS progress_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_textbook_id UUID NOT NULL REFERENCES student_textbooks(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  teacher_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  teacher_name TEXT,
  handover TEXT,
  homework_not_done BOOLEAN NOT NULL DEFAULT FALSE,
  tardy BOOLEAN NOT NULL DEFAULT FALSE,
  schedule_entry_id UUID REFERENCES schedule_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- updated_at自動更新
DROP TRIGGER IF EXISTS update_progress_sessions_updated_at ON progress_sessions;
CREATE TRIGGER update_progress_sessions_updated_at
  BEFORE UPDATE ON progress_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_progress_sessions_student_textbook_id
  ON progress_sessions(student_textbook_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_progress_sessions_teacher_id
  ON progress_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_progress_sessions_session_date
  ON progress_sessions(session_date DESC);
CREATE INDEX IF NOT EXISTS idx_progress_sessions_schedule_entry_id
  ON progress_sessions(schedule_entry_id) WHERE schedule_entry_id IS NOT NULL;

-- student_progress_lessons にセッションIDを追加（後方互換：NULL許容）
ALTER TABLE student_progress_lessons
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES progress_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_progress_lessons_session_id
  ON student_progress_lessons(session_id) WHERE session_id IS NOT NULL;

-- RLS
ALTER TABLE progress_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "progress_sessions_allow_all_auth" ON progress_sessions;
CREATE POLICY "progress_sessions_allow_all_auth" ON progress_sessions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "progress_sessions_allow_all_anon" ON progress_sessions;
CREATE POLICY "progress_sessions_allow_all_anon" ON progress_sessions
  FOR ALL TO anon USING (true) WITH CHECK (true);
