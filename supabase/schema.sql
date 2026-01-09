-- 生徒管理システム - データベーススキーマ v1.5
-- Supabase SQL Editorで実行してください

-- ============================================
-- 教室テーブル
-- ============================================
CREATE TABLE IF NOT EXISTS schools (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 更新日時を自動更新するトリガー（schools）
CREATE OR REPLACE FUNCTION update_schools_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_schools_updated_at ON schools;
CREATE TRIGGER update_schools_updated_at
  BEFORE UPDATE ON schools
  FOR EACH ROW
  EXECUTE FUNCTION update_schools_updated_at_column();

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
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(school_id, student_code)
);

-- 既存のテーブルにカラムを追加（既にテーブルが存在する場合）
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS school_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS class_name VARCHAR(50),
  ADD COLUMN IF NOT EXISTS club VARCHAR(100),
  ADD COLUMN IF NOT EXISTS subject_other VARCHAR(100),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- 既存のsubjectカラムを削除（存在する場合）
ALTER TABLE students DROP COLUMN IF EXISTS subject;

-- 既存のstudent_codeのUNIQUE制約を削除（存在する場合）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'students_student_code_key'
  ) THEN
    ALTER TABLE students DROP CONSTRAINT students_student_code_key;
  END IF;
END $$;

-- 既存データの移行: デフォルト教室を作成して既存生徒に割り当て
-- 注意: この処理は既存データがある場合のみ実行してください
DO $$
DECLARE
  default_school_id UUID;
BEGIN
  -- デフォルト教室が存在しない場合は作成
  IF NOT EXISTS (SELECT 1 FROM schools WHERE code = 'DEFAULT') THEN
    INSERT INTO schools (name, code) 
    VALUES ('デフォルト教室', 'DEFAULT')
    RETURNING id INTO default_school_id;
  ELSE
    SELECT id INTO default_school_id FROM schools WHERE code = 'DEFAULT';
  END IF;

  -- school_idがNULLの既存生徒にデフォルト教室を割り当て
  UPDATE students 
  SET school_id = default_school_id 
  WHERE school_id IS NULL;
END $$;

-- school_idをNOT NULLに変更（既存データ移行後）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'students' 
    AND column_name = 'school_id' 
    AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE students ALTER COLUMN school_id SET NOT NULL;
  END IF;
END $$;

-- 更新日時を自動更新するトリガー
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_student_logs_student_id_created_at ON student_logs(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_logs_school_id ON student_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_student_logs_action ON student_logs(action);

-- ============================================
-- 科目マスタテーブル
-- ============================================
CREATE TABLE IF NOT EXISTS subjects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  grade_category VARCHAR(20) NOT NULL CHECK (grade_category IN ('elementary', 'middle', 'high')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 生徒と科目の中間テーブル
CREATE TABLE IF NOT EXISTS student_subjects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(student_id, subject_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_subjects_grade_category ON subjects(grade_category);
CREATE INDEX IF NOT EXISTS idx_subjects_sort_order ON subjects(grade_category, sort_order);
CREATE INDEX IF NOT EXISTS idx_student_subjects_student_id ON student_subjects(student_id);
CREATE INDEX IF NOT EXISTS idx_student_subjects_subject_id ON student_subjects(subject_id);

-- ============================================
-- RLS (Row Level Security) を有効化
-- ============================================
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_subjects ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーに全権限を付与するポリシー（開発用）
-- 本番環境では適切なポリシーに変更してください

-- schools
DROP POLICY IF EXISTS "Allow all for authenticated users" ON schools;
CREATE POLICY "Allow all for authenticated users" ON schools
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for anon" ON schools;
CREATE POLICY "Allow all for anon" ON schools
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- students
DROP POLICY IF EXISTS "Allow all for authenticated users" ON students;
CREATE POLICY "Allow all for authenticated users" ON students
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for anon" ON students;
CREATE POLICY "Allow all for anon" ON students
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- student_logs
DROP POLICY IF EXISTS "Allow all for authenticated users" ON student_logs;
CREATE POLICY "Allow all for authenticated users" ON student_logs
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for anon" ON student_logs;
CREATE POLICY "Allow all for anon" ON student_logs
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- subjects
DROP POLICY IF EXISTS "Allow all for authenticated users" ON subjects;
CREATE POLICY "Allow all for authenticated users" ON subjects
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for anon" ON subjects;
CREATE POLICY "Allow all for anon" ON subjects
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- student_subjects
DROP POLICY IF EXISTS "Allow all for authenticated users" ON student_subjects;
CREATE POLICY "Allow all for authenticated users" ON student_subjects
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for anon" ON student_subjects;
CREATE POLICY "Allow all for anon" ON student_subjects
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
