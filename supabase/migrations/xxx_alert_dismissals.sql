-- アラート対応済み記録テーブル
CREATE TABLE IF NOT EXISTS alert_dismissals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,  -- 'score_drop', 'score_missing', 'interview_overdue', 'application_overdue'
  alert_key TEXT NOT NULL,   -- 特定のアラートを識別するキー（例: 'regular_test:english:2024-01'）
  dismissed_by UUID REFERENCES user_profiles(id),
  dismissed_at TIMESTAMPTZ DEFAULT NOW(),
  note TEXT,  -- 対応メモ（任意）
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, student_id, alert_type, alert_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_dismissals_school_student 
ON alert_dismissals(school_id, student_id);

ALTER TABLE alert_dismissals ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーを削除してから作成
DROP POLICY IF EXISTS "alert_dismissals_allow_all_auth" ON alert_dismissals;
DROP POLICY IF EXISTS "alert_dismissals_allow_all_anon" ON alert_dismissals;
CREATE POLICY "alert_dismissals_allow_all_auth" ON alert_dismissals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "alert_dismissals_allow_all_anon" ON alert_dismissals
  FOR ALL TO anon USING (true) WITH CHECK (true);
