-- ============================================
-- 申込状況管理テーブル
-- ============================================
-- 申込項目マスタ
CREATE TABLE IF NOT EXISTS application_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 生徒の申込状況
CREATE TABLE IF NOT EXISTS student_applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES application_items(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'not_applicable')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, item_id)
);

-- 更新日時を自動更新するトリガー
DROP TRIGGER IF EXISTS update_application_items_updated_at ON application_items;
CREATE TRIGGER update_application_items_updated_at
  BEFORE UPDATE ON application_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_student_applications_updated_at ON student_applications;
CREATE TRIGGER update_student_applications_updated_at
  BEFORE UPDATE ON student_applications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_application_items_school_id ON application_items(school_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_student_applications_school_id ON student_applications(school_id);
CREATE INDEX IF NOT EXISTS idx_student_applications_student_id ON student_applications(student_id);
CREATE INDEX IF NOT EXISTS idx_student_applications_item_id ON student_applications(item_id);

-- RLS (Row Level Security) を有効化
ALTER TABLE application_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_applications ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーに全権限を付与するポリシー（開発用）
DROP POLICY IF EXISTS "application_items_allow_all_auth" ON application_items;
CREATE POLICY "application_items_allow_all_auth" ON application_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "application_items_allow_all_anon" ON application_items;
CREATE POLICY "application_items_allow_all_anon" ON application_items
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "student_applications_allow_all_auth" ON student_applications;
CREATE POLICY "student_applications_allow_all_auth" ON student_applications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "student_applications_allow_all_anon" ON student_applications;
CREATE POLICY "student_applications_allow_all_anon" ON student_applications
  FOR ALL TO anon USING (true) WITH CHECK (true);
