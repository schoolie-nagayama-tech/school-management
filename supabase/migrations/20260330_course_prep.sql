-- =============================================
-- 講習準備 工程表・進捗管理表
-- =============================================

-- 講習期間メタ（予算コマ等）
CREATE TABLE course_prep_periods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  season TEXT NOT NULL CHECK (season IN ('spring', 'summer', 'winter')),
  year INTEGER NOT NULL,
  budget_koma INTEGER DEFAULT 0,
  schedule_start_date DATE,
  schedule_end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, season, year)
);

-- 進捗管理チェック項目
CREATE TABLE course_prep_progress_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  season TEXT NOT NULL CHECK (season IN ('spring', 'summer', 'winter')),
  year INTEGER NOT NULL,
  name TEXT NOT NULL,
  column_type TEXT NOT NULL DEFAULT 'check' CHECK (column_type IN ('check', 'number', 'date')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_hidden BOOLEAN DEFAULT false,
  manager_only BOOLEAN DEFAULT false,
  column_group TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 生徒×項目データ
CREATE TABLE course_prep_student_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES course_prep_progress_items(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('pending', 'completed', 'not_applicable')),
  number_value NUMERIC,
  date_value DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, item_id)
);

-- 工程表タスク
CREATE TABLE course_prep_schedule_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  season TEXT NOT NULL CHECK (season IN ('spring', 'summer', 'winter')),
  year INTEGER NOT NULL,
  major_category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  deadline TEXT,
  start_date DATE,
  end_date DATE,
  is_completed BOOLEAN DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 工程表マーカー
CREATE TABLE course_prep_schedule_markers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES course_prep_schedule_tasks(id) ON DELETE CASCADE,
  marker_date DATE NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, marker_date)
);

-- テンプレート
CREATE TABLE course_prep_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID,
  template_type TEXT NOT NULL CHECK (template_type IN ('schedule', 'progress')),
  season TEXT CHECK (season IN ('spring', 'summer', 'winter')),
  name TEXT NOT NULL,
  template_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_prep_periods_scope ON course_prep_periods(school_id, season, year);
CREATE INDEX idx_prep_items_scope ON course_prep_progress_items(school_id, season, year, sort_order);
CREATE INDEX idx_prep_student_school ON course_prep_student_progress(school_id);
CREATE INDEX idx_prep_student_item ON course_prep_student_progress(student_id, item_id);
CREATE INDEX idx_prep_tasks_scope ON course_prep_schedule_tasks(school_id, season, year, sort_order);
CREATE INDEX idx_prep_markers_task ON course_prep_schedule_markers(task_id);

-- RLS
ALTER TABLE course_prep_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_prep_progress_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_prep_student_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_prep_schedule_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_prep_schedule_markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_prep_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prep_periods_all" ON course_prep_periods FOR ALL USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_items_all" ON course_prep_progress_items FOR ALL USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_student_progress_all" ON course_prep_student_progress FOR ALL USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_schedule_tasks_all" ON course_prep_schedule_tasks FOR ALL USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_schedule_markers_all" ON course_prep_schedule_markers FOR ALL USING (
  task_id IN (
    SELECT id FROM course_prep_schedule_tasks
    WHERE school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
  )
);
CREATE POLICY "prep_templates_all" ON course_prep_templates FOR ALL USING (
  school_id IS NULL OR school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);

-- デフォルトテンプレートシード
INSERT INTO course_prep_templates (template_type, season, name, is_default, template_data) VALUES
('progress', NULL, '標準進捗管理項目', true, '[
  {"name":"通常週回数","column_type":"number","sort_order":0,"column_group":"基本"},
  {"name":"講習期間通常回数","column_type":"number","sort_order":1,"column_group":"基本"},
  {"name":"学年末テ対","column_type":"check","sort_order":2,"column_group":"面談"},
  {"name":"面談申込・面談日決定","column_type":"check","sort_order":3,"column_group":"面談"},
  {"name":"面談申込未提出者へ電話","column_type":"check","sort_order":4,"column_group":"面談"},
  {"name":"面談資料準備","column_type":"check","sort_order":5,"column_group":"面談"},
  {"name":"生徒面談実施","column_type":"check","sort_order":6,"column_group":"面談"},
  {"name":"父母面談実施","column_type":"check","sort_order":7,"column_group":"面談"},
  {"name":"即決","column_type":"check","sort_order":8,"column_group":"面談"},
  {"name":"増コマ回数決定日","column_type":"date","sort_order":9,"column_group":"増コマ"},
  {"name":"面談欠席者対応","column_type":"check","sort_order":10,"column_group":"面談"},
  {"name":"提示増コマ回数","column_type":"number","sort_order":11,"column_group":"増コマ"},
  {"name":"増コマ回数決定","column_type":"number","sort_order":12,"column_group":"増コマ"},
  {"name":"映像申込","column_type":"check","sort_order":13,"column_group":"事務"},
  {"name":"日程表回収","column_type":"check","sort_order":14,"column_group":"事務"},
  {"name":"教材発注","column_type":"check","sort_order":15,"column_group":"事務"},
  {"name":"講習費売上計上","column_type":"check","sort_order":16,"column_group":"事務"},
  {"name":"座席表入力","column_type":"check","sort_order":17,"column_group":"事務"},
  {"name":"提示コマ(英語)","column_type":"number","sort_order":18,"column_group":"教科別"},
  {"name":"提示コマ(数学)","column_type":"number","sort_order":19,"column_group":"教科別"},
  {"name":"提示コマ(国語)","column_type":"number","sort_order":20,"column_group":"教科別"},
  {"name":"提示コマ(理科)","column_type":"number","sort_order":21,"column_group":"教科別"},
  {"name":"提示コマ(社会)","column_type":"number","sort_order":22,"column_group":"教科別"},
  {"name":"提示総コマ合計","column_type":"number","sort_order":23,"column_group":"教科別"}
]'::jsonb),
('schedule', 'summer', '夏期講習準備スケジュール', true, '[
  {"major_category":"プラン作成","name":"PCS実施","description":"中学生はEMの2科、小学生はMJ","sort_order":0},
  {"major_category":"プラン作成","name":"PCS回収・入力","description":"回収からSKS入力まで","sort_order":1},
  {"major_category":"プラン作成","name":"講習プラン作成","description":"中3は3科提案、小～中2は2科＋必要科目","sort_order":2},
  {"major_category":"面談","name":"面談のお知らせ発送","description":"月謝案内と同封","sort_order":3},
  {"major_category":"面談","name":"進路希望調査発送","description":"中3・高3対象","sort_order":4},
  {"major_category":"面談","name":"面談申込書回収","description":"全員参加","sort_order":5},
  {"major_category":"面談","name":"未提出者への電話確認","description":"","sort_order":6},
  {"major_category":"面談","name":"生徒面談資料作成","description":"個別プラン表入力＆印刷","sort_order":7},
  {"major_category":"面談","name":"生徒面談実施","description":"目標の明確化","sort_order":8},
  {"major_category":"面談","name":"保護者面談資料準備","description":"封筒準備、プラン製本、申込書印刷","sort_order":9},
  {"major_category":"面談","name":"保護者面談実施","description":"","sort_order":10},
  {"major_category":"面談","name":"申込書受付締切","description":"面談日から1週間","sort_order":11},
  {"major_category":"業務・教務","name":"座席・日程調整","description":"システム入力","sort_order":12},
  {"major_category":"業務・教務","name":"プラン・回数調整","description":"申込回数にプランを調整","sort_order":13},
  {"major_category":"業務・教務","name":"生徒日程表開示","description":"","sort_order":14},
  {"major_category":"業務・教務","name":"教材発注","description":"在塾生分","sort_order":15},
  {"major_category":"講師関連","name":"講師シフト作成・調整","description":"帰省・旅行予定を把握","sort_order":16},
  {"major_category":"講師関連","name":"講師研修実施","description":"","sort_order":17}
]'::jsonb);
