-- ============================================================
-- ORPHAN TABLES (リポジトリに定義がないがローカルDBに必要な表)
-- ============================================================
-- 本番DBには手動SQLで作成されたが、リポジトリに CREATE TABLE 文が
-- コミットされていないテーブル群。src/types/database.ts から復元。
-- ローカル開発/テスト専用。
-- ============================================================

-- テキストマスタ
CREATE TABLE IF NOT EXISTS textbooks (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  publisher TEXT,
  school_type TEXT,
  grade TEXT,
  subject TEXT,
  revision_date TEXT,
  sheet_gid TEXT,
  grade_category VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- カリキュラム項目
CREATE TABLE IF NOT EXISTS curriculum_items (
  id SERIAL PRIMARY KEY,
  textbook_id INTEGER NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  item_number INTEGER,
  item_type TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 科目マスタ
CREATE TABLE IF NOT EXISTS subjects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 生徒-科目リンク
CREATE TABLE IF NOT EXISTS student_subjects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, subject_id)
);
