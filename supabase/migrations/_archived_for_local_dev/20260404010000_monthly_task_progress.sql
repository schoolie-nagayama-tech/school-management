-- 業務進捗管理表: 月次タスク管理テーブル群
-- テンプレートから毎月タスクを生成し、教室ごとの完了チェックを管理する

-- 1. テンプレート定義
CREATE TABLE IF NOT EXISTS monthly_task_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  template_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- template_data: [{day_of_month: number, task_name: string, category: 'business'|'course', sort_order: number}]
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 月次タスク実体（教室非依存）
CREATE TABLE IF NOT EXISTS monthly_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  task_date DATE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('business', 'course')),
  task_name TEXT NOT NULL,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  linked_schedule_task_id UUID REFERENCES course_prep_schedule_tasks(id) ON DELETE SET NULL,
  template_id UUID REFERENCES monthly_task_templates(id) ON DELETE SET NULL,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monthly_tasks_period ON monthly_tasks(year, month, task_date, sort_order);
CREATE INDEX IF NOT EXISTS idx_monthly_tasks_linked ON monthly_tasks(linked_schedule_task_id) WHERE linked_schedule_task_id IS NOT NULL;

-- 3. 教室ごとの完了チェック
CREATE TABLE IF NOT EXISTS monthly_task_checks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES monthly_tasks(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_task_checks_task ON monthly_task_checks(task_id);
CREATE INDEX IF NOT EXISTS idx_monthly_task_checks_school ON monthly_task_checks(school_id);

-- RLS
ALTER TABLE monthly_task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_task_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "monthly_templates_select" ON monthly_task_templates FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "monthly_templates_insert" ON monthly_task_templates FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "monthly_templates_update" ON monthly_task_templates FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "monthly_templates_delete" ON monthly_task_templates FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "monthly_tasks_select" ON monthly_tasks FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "monthly_tasks_insert" ON monthly_tasks FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "monthly_tasks_update" ON monthly_tasks FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "monthly_tasks_delete" ON monthly_tasks FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "monthly_task_checks_select" ON monthly_task_checks FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "monthly_task_checks_insert" ON monthly_task_checks FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "monthly_task_checks_update" ON monthly_task_checks FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "monthly_task_checks_delete" ON monthly_task_checks FOR DELETE USING (auth.uid() IS NOT NULL);
