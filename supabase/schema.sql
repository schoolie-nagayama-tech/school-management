-- 生徒管理システム - データベーススキーマ v1.5
-- Supabase SQL Editorで実行してください

-- ============================================
-- 共通：updated_at 自動更新（汎用）
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 教室テーブル
-- ============================================
CREATE TABLE IF NOT EXISTS schools (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_schools_updated_at ON schools;
CREATE TRIGGER update_schools_updated_at
  BEFORE UPDATE ON schools
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 生徒テーブル
-- ============================================
CREATE TABLE IF NOT EXISTS students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_code VARCHAR(20),
  last_name VARCHAR(50) NOT NULL,
  first_name VARCHAR(50) NOT NULL,
  last_name_kana VARCHAR(50) NOT NULL,
  first_name_kana VARCHAR(50) NOT NULL,
  grade INTEGER NOT NULL CHECK (grade >= 1 AND grade <= 13),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'withdrawn')),
  school_name VARCHAR(100),
  class_name VARCHAR(50),
  club VARCHAR(100),
  subject_other VARCHAR(100),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (school_id, student_code)
);

-- 既存テーブルがある場合の追記（安全に）
ALTER TABLE students ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE RESTRICT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS school_name VARCHAR(100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS class_name VARCHAR(50);
ALTER TABLE students ADD COLUMN IF NOT EXISTS club VARCHAR(100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS subject_other VARCHAR(100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 既存 subject カラムがあれば削除
ALTER TABLE students DROP COLUMN IF EXISTS subject;

-- 旧: student_code 単独ユニーク制約がある場合は削除（名前が students_student_code_key の想定）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'students_student_code_key'
      AND conrelid = 'students'::regclass
  ) THEN
    ALTER TABLE students DROP CONSTRAINT students_student_code_key;
  END IF;
END $$;

-- 既存データ移行：DEFAULT教室を作成して school_id が NULL の生徒に割り当て
DO $$
DECLARE
  default_school_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schools WHERE code = 'DEFAULT') THEN
    INSERT INTO schools (name, code)
    VALUES ('デフォルト教室', 'DEFAULT')
    RETURNING id INTO default_school_id;
  ELSE
    SELECT id INTO default_school_id FROM schools WHERE code = 'DEFAULT';
  END IF;

  UPDATE students
  SET school_id = default_school_id
  WHERE school_id IS NULL;
END $$;

-- school_id を NOT NULL に（nullable の場合のみ）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'students'
      AND column_name = 'school_id'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE students ALTER COLUMN school_id SET NOT NULL;
  END IF;
END $$;

DROP TRIGGER IF EXISTS update_students_updated_at ON students;
CREATE TRIGGER update_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_students_school_id_deleted_at ON students(school_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_students_school_id_status_grade ON students(school_id, status, grade);
CREATE INDEX IF NOT EXISTS idx_students_school_id_kana ON students(school_id, last_name_kana, first_name_kana);
CREATE INDEX IF NOT EXISTS idx_students_student_code ON students(student_code);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_students_grade ON students(grade);
CREATE INDEX IF NOT EXISTS idx_students_name ON students(last_name, first_name);

-- ============================================
-- 生徒ログテーブル
-- ============================================
CREATE TABLE IF NOT EXISTS student_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'soft_deleted', 'restored', 'status_changed')),
  actor TEXT,
  diff JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_logs_student_id_created_at ON student_logs(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_logs_school_id ON student_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_student_logs_action ON student_logs(action);

-- ============================================
-- 科目マスタ（※この構成を使うなら。成績v2は subject TEXT でも動く）
-- ============================================
CREATE TABLE IF NOT EXISTS subjects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  grade_category VARCHAR(20) NOT NULL CHECK (grade_category IN ('elementary', 'middle', 'high')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_subjects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_subjects_grade_category ON subjects(grade_category);
CREATE INDEX IF NOT EXISTS idx_subjects_sort_order ON subjects(grade_category, sort_order);
CREATE INDEX IF NOT EXISTS idx_student_subjects_student_id ON student_subjects(student_id);
CREATE INDEX IF NOT EXISTS idx_student_subjects_subject_id ON student_subjects(subject_id);

-- ============================================
-- 成績管理テーブル
-- ============================================
CREATE TABLE IF NOT EXISTS assessments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK (category IN ('regular_test', 'report_card', 'mock')),
  title TEXT,                -- 互換のため残す（運用は name_code 推奨）
  name_code TEXT,            -- プルダウンの固定コード（後で NOT NULL にする）
  exam_date DATE,            -- 互換のため残す（運用は exam_month 推奨）
  exam_month DATE,           -- YYYY-MM-01 で保存（UIはYYYY-MMのみ）
  grade INTEGER CHECK (grade >= 1 AND grade <= 13),
  term TEXT,                 -- 任意（未使用ならOK）
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessment_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  value NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (assessment_id, subject)
);

DROP TRIGGER IF EXISTS update_assessments_updated_at ON assessments;
CREATE TRIGGER update_assessments_updated_at
  BEFORE UPDATE ON assessments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_assessments_school_student_category_date
  ON assessments(school_id, student_id, category, exam_date DESC);

CREATE INDEX IF NOT EXISTS idx_assessment_scores_assessment_id
  ON assessment_scores(assessment_id);

-- ============================================
-- assessments 既存データ移行（既存テーブルにも対応）
-- ============================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'assessments') THEN

    ALTER TABLE assessments ADD COLUMN IF NOT EXISTS exam_month DATE;
    ALTER TABLE assessments ADD COLUMN IF NOT EXISTS name_code TEXT;

    -- exam_date -> exam_month (YYYY-MM-01)
    UPDATE assessments
    SET exam_month = DATE_TRUNC('month', exam_date)::DATE
    WHERE exam_date IS NOT NULL AND exam_month IS NULL;

    -- title -> name_code（簡易マッピング。不明は legacy）
    UPDATE assessments
    SET name_code = CASE
      WHEN category = 'regular_test' AND title LIKE '%1学期中間%' THEN 'term1_mid'
      WHEN category = 'regular_test' AND title LIKE '%1学期期末%' THEN 'term1_final'
      WHEN category = 'regular_test' AND title LIKE '%2学期中間%' THEN 'term2_mid'
      WHEN category = 'regular_test' AND title LIKE '%2学期期末%' THEN 'term2_final'
      WHEN category = 'regular_test' AND title LIKE '%学年末%' THEN 'year_end'
      WHEN category = 'regular_test' AND title LIKE '%前期中間%' THEN 'first_mid'
      WHEN category = 'regular_test' AND title LIKE '%前期期末%' THEN 'first_final'
      WHEN category = 'regular_test' AND title LIKE '%後期中間%' THEN 'second_mid'
      WHEN category = 'regular_test' AND title LIKE '%後期期末%' THEN 'second_final'
      WHEN category = 'report_card'  AND title LIKE '%1学期%' THEN 'term1'
      WHEN category = 'report_card'  AND title LIKE '%2学期%' THEN 'term2'
      WHEN category = 'report_card'  AND title LIKE '%学年末%' THEN 'year_end'
      WHEN category = 'report_card'  AND title LIKE '%前期%' THEN 'first'
      WHEN category = 'report_card'  AND title LIKE '%後期%' THEN 'second'
      WHEN category = 'mock'         AND title LIKE '%会場%' THEN 'venue'
      WHEN category = 'mock'         AND title LIKE '%教室%' THEN 'classroom'
      ELSE 'legacy'
    END
    WHERE name_code IS NULL;

    -- grade が NULL の場合は students.grade を暫定コピー
    UPDATE assessments a
    SET grade = s.grade
    FROM students s
    WHERE a.student_id = s.id
      AND a.grade IS NULL;

    -- まだ NULL のものを埋める
    UPDATE assessments SET name_code = 'legacy' WHERE name_code IS NULL;
    UPDATE assessments SET grade = 1 WHERE grade IS NULL;

    -- NOT NULL 付与（将来必須運用）
    ALTER TABLE assessments ALTER COLUMN name_code SET NOT NULL;
    ALTER TABLE assessments ALTER COLUMN grade SET NOT NULL;

  END IF;
END $$;

-- categoryごとの name_code 制約
ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_name_code_check;
ALTER TABLE assessments ADD CONSTRAINT assessments_name_code_check CHECK (
  (category = 'regular_test' AND name_code IN (
    'term1_mid','term1_final','term2_mid','term2_final','year_end',
    'first_mid','first_final','second_mid','second_final','legacy'
  )) OR
  (category = 'report_card' AND name_code IN (
    'term1','term2','year_end','first','second','legacy'
  )) OR
  (category = 'mock' AND name_code IN (
    'venue','classroom','legacy'
  ))
);

CREATE INDEX IF NOT EXISTS idx_assessments_school_student_category_grade_month
  ON assessments(school_id, student_id, category, grade DESC, exam_month DESC, name_code);

-- ============================================
-- RLS（開発用：anon/authenticated を全許可）
-- ※本番は必ず絞る。今は「認証後回し」でも、テーブルが読めるようにだけしておく。
-- ============================================
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_scores ENABLE ROW LEVEL SECURITY;

-- 共通ポリシー名は衝突しやすいのでテーブル別にする
-- schools
DROP POLICY IF EXISTS "schools_allow_all_auth" ON schools;
CREATE POLICY "schools_allow_all_auth" ON schools
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "schools_allow_all_anon" ON schools;
CREATE POLICY "schools_allow_all_anon" ON schools
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- students
DROP POLICY IF EXISTS "students_allow_all_auth" ON students;
CREATE POLICY "students_allow_all_auth" ON students
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "students_allow_all_anon" ON students;
CREATE POLICY "students_allow_all_anon" ON students
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- student_logs
DROP POLICY IF EXISTS "student_logs_allow_all_auth" ON student_logs;
CREATE POLICY "student_logs_allow_all_auth" ON student_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "student_logs_allow_all_anon" ON student_logs;
CREATE POLICY "student_logs_allow_all_anon" ON student_logs
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- subjects
DROP POLICY IF EXISTS "subjects_allow_all_auth" ON subjects;
CREATE POLICY "subjects_allow_all_auth" ON subjects
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "subjects_allow_all_anon" ON subjects;
CREATE POLICY "subjects_allow_all_anon" ON subjects
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- student_subjects
DROP POLICY IF EXISTS "student_subjects_allow_all_auth" ON student_subjects;
CREATE POLICY "student_subjects_allow_all_auth" ON student_subjects
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "student_subjects_allow_all_anon" ON student_subjects;
CREATE POLICY "student_subjects_allow_all_anon" ON student_subjects
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- assessments
DROP POLICY IF EXISTS "assessments_allow_all_auth" ON assessments;
CREATE POLICY "assessments_allow_all_auth" ON assessments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "assessments_allow_all_anon" ON assessments;
CREATE POLICY "assessments_allow_all_anon" ON assessments
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- assessment_scores
DROP POLICY IF EXISTS "assessment_scores_allow_all_auth" ON assessment_scores;
CREATE POLICY "assessment_scores_allow_all_auth" ON assessment_scores
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "assessment_scores_allow_all_anon" ON assessment_scores;
CREATE POLICY "assessment_scores_allow_all_anon" ON assessment_scores
  FOR ALL TO anon USING (true) WITH CHECK (true);
-- ============================================
-- 逕ｳ霎ｼ迥ｶ豕∫ｮ｡逅・ユ繝ｼ繝悶Ν
-- ============================================
-- 逕ｳ霎ｼ鬆・岼繝槭せ繧ｿ
CREATE TABLE IF NOT EXISTS application_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 逕溷ｾ偵・逕ｳ霎ｼ迥ｶ豕・
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

-- 譖ｴ譁ｰ譌･譎ゅｒ閾ｪ蜍墓峩譁ｰ縺吶ｋ繝医Μ繧ｬ繝ｼ
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

-- 繧､繝ｳ繝・ャ繧ｯ繧ｹ
CREATE INDEX IF NOT EXISTS idx_application_items_school_id ON application_items(school_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_student_applications_school_id ON student_applications(school_id);
CREATE INDEX IF NOT EXISTS idx_student_applications_student_id ON student_applications(student_id);
CREATE INDEX IF NOT EXISTS idx_student_applications_item_id ON student_applications(item_id);

-- RLS (Row Level Security) 繧呈怏蜉ｹ蛹・
ALTER TABLE application_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_applications ENABLE ROW LEVEL SECURITY;

-- 隱崎ｨｼ貂医∩繝ｦ繝ｼ繧ｶ繝ｼ縺ｫ蜈ｨ讓ｩ髯舌ｒ莉倅ｸ弱☆繧九・繝ｪ繧ｷ繝ｼ・磯幕逋ｺ逕ｨ・・
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

-- ============================================
-- ポータルメニューテーブル
-- ============================================
CREATE TABLE IF NOT EXISTS portal_menu (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  menu_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  link_type TEXT NOT NULL DEFAULT 'external' CHECK (link_type IN ('internal', 'external')),
  link_url TEXT,
  link_urls JSONB DEFAULT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, menu_key)
);

-- updated_at自動更新
DROP TRIGGER IF EXISTS update_portal_menu_updated_at ON portal_menu;
CREATE TRIGGER update_portal_menu_updated_at
  BEFORE UPDATE ON portal_menu
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_portal_menu_school_id ON portal_menu(school_id);
CREATE INDEX IF NOT EXISTS idx_portal_menu_school_visible_order ON portal_menu(school_id, is_visible, sort_order);
CREATE INDEX IF NOT EXISTS idx_portal_menu_link_urls ON portal_menu USING GIN (link_urls);

-- RLS (Row Level Security) ポリシー
ALTER TABLE portal_menu ENABLE ROW LEVEL SECURITY;

-- すべてのユーザーに許可（認証・未認証問わず）
DROP POLICY IF EXISTS "portal_menu_allow_all_auth" ON portal_menu;
CREATE POLICY "portal_menu_allow_all_auth" ON portal_menu
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "portal_menu_allow_all_anon" ON portal_menu;
CREATE POLICY "portal_menu_allow_all_anon" ON portal_menu
  FOR ALL TO anon USING (true) WITH CHECK (true);
