-- ============================================
-- フォーム機能テーブル
-- ============================================
-- フォームテンプレート
CREATE TABLE IF NOT EXISTS form_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- テンプレートの項目定義
CREATE TABLE IF NOT EXISTS form_template_fields (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'textarea', 'select', 'radio', 'checkbox', 'date', 'number')),
  label TEXT NOT NULL,
  placeholder TEXT,
  options JSONB,
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 実際のフォーム
CREATE TABLE IF NOT EXISTS forms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  template_id UUID REFERENCES form_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  publish_start TIMESTAMPTZ,
  publish_end TIMESTAMPTZ,
  completion_message TEXT,
  linked_application_item_id UUID REFERENCES application_items(id) ON DELETE SET NULL,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, slug)
);

-- フォームの項目
CREATE TABLE IF NOT EXISTS form_fields (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  field_type TEXT NOT NULL CHECK (field_type IN ('text', 'textarea', 'select', 'radio', 'checkbox', 'date', 'number')),
  label TEXT NOT NULL,
  placeholder TEXT,
  options JSONB,
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- フォーム回答
CREATE TABLE IF NOT EXISTS form_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE RESTRICT,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_name TEXT NOT NULL,
  grade INTEGER CHECK (grade >= 1 AND grade <= 13),
  email TEXT,
  answers JSONB NOT NULL DEFAULT '{}',
  linked_student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  linked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 更新日時を自動更新するトリガー
DROP TRIGGER IF EXISTS update_form_templates_updated_at ON form_templates;
CREATE TRIGGER update_form_templates_updated_at
  BEFORE UPDATE ON form_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_forms_updated_at ON forms;
CREATE TRIGGER update_forms_updated_at
  BEFORE UPDATE ON forms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_form_templates_school_id ON form_templates(school_id);
CREATE INDEX IF NOT EXISTS idx_form_template_fields_template_id ON form_template_fields(template_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_forms_school_id ON forms(school_id);
CREATE INDEX IF NOT EXISTS idx_forms_slug ON forms(school_id, slug);
CREATE INDEX IF NOT EXISTS idx_forms_status ON forms(status);
CREATE INDEX IF NOT EXISTS idx_forms_publish_dates ON forms(publish_start, publish_end);
CREATE INDEX IF NOT EXISTS idx_forms_is_archived ON forms(is_archived);
CREATE INDEX IF NOT EXISTS idx_form_fields_form_id ON form_fields(form_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_form_responses_form_id ON form_responses(form_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_responses_school_id ON form_responses(school_id);
CREATE INDEX IF NOT EXISTS idx_form_responses_linked_student_id ON form_responses(linked_student_id);

-- RLS (Row Level Security) を有効化
ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_template_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_responses ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーに全権限を付与するポリシー（開発用）
DROP POLICY IF EXISTS "form_templates_allow_all_auth" ON form_templates;
CREATE POLICY "form_templates_allow_all_auth" ON form_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "form_templates_allow_all_anon" ON form_templates;
CREATE POLICY "form_templates_allow_all_anon" ON form_templates
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "form_template_fields_allow_all_auth" ON form_template_fields;
CREATE POLICY "form_template_fields_allow_all_auth" ON form_template_fields
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "form_template_fields_allow_all_anon" ON form_template_fields;
CREATE POLICY "form_template_fields_allow_all_anon" ON form_template_fields
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "forms_allow_all_auth" ON forms;
CREATE POLICY "forms_allow_all_auth" ON forms
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "forms_allow_all_anon" ON forms;
CREATE POLICY "forms_allow_all_anon" ON forms
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "form_fields_allow_all_auth" ON form_fields;
CREATE POLICY "form_fields_allow_all_auth" ON form_fields
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "form_fields_allow_all_anon" ON form_fields;
CREATE POLICY "form_fields_allow_all_anon" ON form_fields
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "form_responses_allow_all_auth" ON form_responses;
CREATE POLICY "form_responses_allow_all_auth" ON form_responses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "form_responses_allow_all_anon" ON form_responses;
CREATE POLICY "form_responses_allow_all_anon" ON form_responses
  FOR ALL TO anon USING (true) WITH CHECK (true);
