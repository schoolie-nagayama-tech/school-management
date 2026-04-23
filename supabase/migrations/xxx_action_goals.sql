-- ============================================
-- action_goals (行動目標)
-- ============================================
-- 試験目標に紐づく「達成のための行動」。
-- 講師が達成/未達の判定を行う。期間経過後は削除せずアーカイブ扱い（親の exam 削除で cascade）。
-- 将来的にテスト結果と連動して自動達成判定する土台。
-- ============================================

CREATE TABLE IF NOT EXISTS action_goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_textbook_exam_id UUID NOT NULL REFERENCES student_textbook_exams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  /** 回数カウンター目標 (例: 3周 → 3)。null = カウンターなし */
  counter_target INTEGER,
  /** 現在の達成回数 (counter_target があるときのみ意味を持つ) */
  counter_current INTEGER DEFAULT 0,
  /** 達成フラグ (講師がチェック) */
  achieved BOOLEAN DEFAULT FALSE,
  /** 達成日時 (達成時に自動セット推奨) */
  achieved_at TIMESTAMPTZ,
  /** 並び順 */
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- updated_at 自動更新
DROP TRIGGER IF EXISTS update_action_goals_updated_at ON action_goals;
CREATE TRIGGER update_action_goals_updated_at
  BEFORE UPDATE ON action_goals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_action_goals_exam_id ON action_goals(student_textbook_exam_id);
CREATE INDEX IF NOT EXISTS idx_action_goals_sort ON action_goals(student_textbook_exam_id, sort_order);

-- RLS
ALTER TABLE action_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "action_goals_allow_all_auth" ON action_goals;
CREATE POLICY "action_goals_allow_all_auth" ON action_goals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "action_goals_allow_all_anon" ON action_goals;
CREATE POLICY "action_goals_allow_all_anon" ON action_goals
  FOR ALL TO anon USING (true) WITH CHECK (true);
