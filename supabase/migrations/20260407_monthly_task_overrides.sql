-- 教室別タスクオーバーライド: 各教室が独自にタスクを編集できるようにする
CREATE TABLE IF NOT EXISTS monthly_task_overrides (
  task_id UUID NOT NULL REFERENCES monthly_tasks(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  task_name TEXT,       -- NULLならベースを使用
  task_date DATE,       -- NULLならベースを使用
  category TEXT,        -- NULLならベースを使用
  note TEXT,            -- NULLならベースを使用
  url TEXT,             -- NULLならベースを使用
  is_hidden BOOLEAN DEFAULT false,  -- trueならその教室では非表示
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (task_id, school_id)
);

ALTER TABLE monthly_task_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can manage overrides"
  ON monthly_task_overrides
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
