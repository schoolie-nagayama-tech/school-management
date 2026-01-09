-- 生徒管理システム - データベーススキーマ
-- Supabase SQL Editorで実行してください

-- 生徒テーブル
CREATE TABLE IF NOT EXISTS students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_code VARCHAR(20) UNIQUE,
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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 既存のテーブルにカラムを追加（既にテーブルが存在する場合）
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS school_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS class_name VARCHAR(50),
  ADD COLUMN IF NOT EXISTS club VARCHAR(100),
  ADD COLUMN IF NOT EXISTS subject_other VARCHAR(100);

-- 既存のsubjectカラムを削除（存在する場合）
ALTER TABLE students DROP COLUMN IF EXISTS subject;

-- 更新日時を自動更新するトリガー
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 既存のトリガーを削除してから再作成
DROP TRIGGER IF EXISTS update_students_updated_at ON students;
CREATE TRIGGER update_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_students_student_code ON students(student_code);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_students_grade ON students(grade);
CREATE INDEX IF NOT EXISTS idx_students_name ON students(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_students_kana ON students(last_name_kana, first_name_kana);

-- RLS (Row Level Security) を有効化
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーに全権限を付与するポリシー（開発用）
-- 本番環境では適切なポリシーに変更してください
DROP POLICY IF EXISTS "Allow all for authenticated users" ON students;
CREATE POLICY "Allow all for authenticated users" ON students
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 匿名アクセスを許可（開発用）
-- 本番環境では削除または制限してください
DROP POLICY IF EXISTS "Allow all for anon" ON students;
CREATE POLICY "Allow all for anon" ON students
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- 科目マスタテーブル
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

-- RLS (Row Level Security) を有効化
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_subjects ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーに全権限を付与するポリシー（開発用）
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

-- サンプルデータ（任意）
-- INSERT INTO students (student_code, last_name, first_name, last_name_kana, first_name_kana, grade, status) VALUES
-- ('S0001', '山田', '太郎', 'ヤマダ', 'タロウ', 7, 'active'),
-- ('S0002', '鈴木', '花子', 'スズキ', 'ハナコ', 8, 'active'),
-- ('S0003', '佐藤', '一郎', 'サトウ', 'イチロウ', 9, 'active');
