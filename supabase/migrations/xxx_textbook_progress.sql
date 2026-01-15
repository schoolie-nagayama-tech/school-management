-- テキスト進行管理機能 - データベースマイグレーション
-- Supabase SQL Editorで実行してください

-- ============================================
-- 1. exam_types（テスト名マスタ）
-- ============================================
CREATE TABLE IF NOT EXISTS exam_types (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- updated_at自動更新
DROP TRIGGER IF EXISTS update_exam_types_updated_at ON exam_types;
CREATE TRIGGER update_exam_types_updated_at
  BEFORE UPDATE ON exam_types
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_exam_types_school_id ON exam_types(school_id, sort_order);

-- デフォルトデータ挿入
INSERT INTO exam_types (school_id, name, sort_order)
SELECT 
  id,
  unnest(ARRAY[
    '1学期中間',
    '1学期期末',
    '2学期中間',
    '2学期期末',
    '学年末',
    '前期中間',
    '前期期末',
    '後期中間',
    '後期期末'
  ]) AS name,
  unnest(ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9]) AS sort_order
FROM schools
WHERE NOT EXISTS (
  SELECT 1 FROM exam_types WHERE exam_types.school_id = schools.id
);

-- ============================================
-- 2. textbooks（テキストマスタ）※既存テーブルを使用
-- ============================================
-- 既存のtextbooksテーブルを使用（カラム追加のみ）
-- 既存カラム: id, name, publisher, school_type, grade, subject, revision_date, sheet_gid, created_at

-- grade_categoryカラムを追加（school_typeから変換可能な値）
ALTER TABLE textbooks ADD COLUMN IF NOT EXISTS grade_category VARCHAR(20);

-- grade_categoryの値を設定（school_typeから変換）
UPDATE textbooks 
SET grade_category = CASE 
  WHEN school_type LIKE '%小%' OR school_type LIKE '%elementary%' THEN 'elementary'
  WHEN school_type LIKE '%中%' OR school_type LIKE '%middle%' THEN 'middle'
  WHEN school_type LIKE '%高%' OR school_type LIKE '%high%' THEN 'high'
  ELSE NULL
END
WHERE grade_category IS NULL;

-- grade_categoryの制約を追加（既存の制約がない場合のみ）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'textbooks_grade_category_check'
  ) THEN
    ALTER TABLE textbooks ADD CONSTRAINT textbooks_grade_category_check 
      CHECK (grade_category IS NULL OR grade_category IN ('elementary', 'middle', 'high'));
  END IF;
END $$;

-- updated_atカラムを追加（既存テーブルにない場合）
ALTER TABLE textbooks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- updated_at自動更新
DROP TRIGGER IF EXISTS update_textbooks_updated_at ON textbooks;
CREATE TRIGGER update_textbooks_updated_at
  BEFORE UPDATE ON textbooks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- インデックス（grade_categoryがNULLでない場合に有効）
CREATE INDEX IF NOT EXISTS idx_textbooks_grade_category ON textbooks(grade_category) WHERE grade_category IS NOT NULL;

-- ============================================
-- 3. curriculum_items（目次項目マスタ）※既存テーブルを使用
-- ============================================
-- 既存のcurriculum_itemsテーブルを使用（カラム追加のみ）
-- 既存カラム: id, textbook_id, sort_order, item_number, title, item_type, created_at

-- 既存テーブルにないカラムを追加（既存テーブルがある場合はスキップ）
ALTER TABLE curriculum_items ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE curriculum_items ADD COLUMN IF NOT EXISTS item_number INTEGER;
ALTER TABLE curriculum_items ADD COLUMN IF NOT EXISTS item_type TEXT;
ALTER TABLE curriculum_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE curriculum_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- item_nameカラムがある場合はtitleに移行（既存データの移行）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'curriculum_items' 
    AND column_name = 'item_name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'curriculum_items' 
    AND column_name = 'title'
  ) THEN
    ALTER TABLE curriculum_items ADD COLUMN title TEXT;
    UPDATE curriculum_items SET title = item_name WHERE title IS NULL;
  END IF;
END $$;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_curriculum_items_textbook_id ON curriculum_items(textbook_id, sort_order);

-- ============================================
-- 4. student_textbooks（生徒×テキスト紐付け）
-- ============================================
CREATE TABLE IF NOT EXISTS student_textbooks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  textbook_id INTEGER NOT NULL REFERENCES textbooks(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, textbook_id)
);

-- updated_at自動更新
DROP TRIGGER IF EXISTS update_student_textbooks_updated_at ON student_textbooks;
CREATE TRIGGER update_student_textbooks_updated_at
  BEFORE UPDATE ON student_textbooks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_student_textbooks_student_id ON student_textbooks(student_id, is_active);
CREATE INDEX IF NOT EXISTS idx_student_textbooks_textbook_id ON student_textbooks(textbook_id);
CREATE INDEX IF NOT EXISTS idx_student_textbooks_school_id ON student_textbooks(school_id);

-- ============================================
-- 5. student_textbook_settings（生徒×テキストのヘッダー設定）
-- ============================================
CREATE TABLE IF NOT EXISTS student_textbook_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_textbook_id UUID NOT NULL REFERENCES student_textbooks(id) ON DELETE CASCADE,
  goal_period TEXT,
  goal_score INTEGER,
  approach TEXT,
  homework_style TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_textbook_id)
);

-- updated_at自動更新
DROP TRIGGER IF EXISTS update_student_textbook_settings_updated_at ON student_textbook_settings;
CREATE TRIGGER update_student_textbook_settings_updated_at
  BEFORE UPDATE ON student_textbook_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 6. student_textbook_exams（テスト設定）
-- ============================================
CREATE TABLE IF NOT EXISTS student_textbook_exams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_textbook_id UUID NOT NULL REFERENCES student_textbooks(id) ON DELETE CASCADE,
  exam_type_id UUID REFERENCES exam_types(id) ON DELETE RESTRICT,
  custom_exam_name TEXT,
  exam_date DATE NOT NULL,
  target_score INTEGER,
  exam_range TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK ((exam_type_id IS NOT NULL) OR (custom_exam_name IS NOT NULL))
);

-- updated_at自動更新
DROP TRIGGER IF EXISTS update_student_textbook_exams_updated_at ON student_textbook_exams;
CREATE TRIGGER update_student_textbook_exams_updated_at
  BEFORE UPDATE ON student_textbook_exams
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 既存テーブルにcustom_exam_nameカラムを追加（既に存在する場合はスキップ）
ALTER TABLE student_textbook_exams ADD COLUMN IF NOT EXISTS custom_exam_name TEXT;
-- exam_type_idをNULL許可に変更（既にNULL許可の場合はエラーを無視）
DO $$
BEGIN
  ALTER TABLE student_textbook_exams ALTER COLUMN exam_type_id DROP NOT NULL;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
-- CHECK制約を追加（exam_type_idまたはcustom_exam_nameのいずれかが必須）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'student_textbook_exams_exam_name_check'
  ) THEN
    ALTER TABLE student_textbook_exams 
    ADD CONSTRAINT student_textbook_exams_exam_name_check 
    CHECK ((exam_type_id IS NOT NULL) OR (custom_exam_name IS NOT NULL));
  END IF;
END $$;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_student_textbook_exams_student_textbook_id ON student_textbook_exams(student_textbook_id);
CREATE INDEX IF NOT EXISTS idx_student_textbook_exams_exam_date ON student_textbook_exams(exam_date);

-- ============================================
-- 7. student_progress（進行記録 - メインテーブル）
-- ============================================
CREATE TABLE IF NOT EXISTS student_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_textbook_id UUID NOT NULL REFERENCES student_textbooks(id) ON DELETE CASCADE,
  curriculum_item_id INTEGER NOT NULL REFERENCES curriculum_items(id) ON DELETE RESTRICT,
  proposal_count INTEGER DEFAULT 0,
  application_count INTEGER DEFAULT 0,
  exam_range_exam_type_id UUID REFERENCES exam_types(id) ON DELETE SET NULL,
  school_progress_date DATE,
  handover TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_textbook_id, curriculum_item_id)
);

-- updated_at自動更新
DROP TRIGGER IF EXISTS update_student_progress_updated_at ON student_progress;
CREATE TRIGGER update_student_progress_updated_at
  BEFORE UPDATE ON student_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_student_progress_student_textbook_id ON student_progress(student_textbook_id);
CREATE INDEX IF NOT EXISTS idx_student_progress_curriculum_item_id ON student_progress(curriculum_item_id);

-- ============================================
-- 8. student_progress_lessons（指導日記録）
-- ============================================
CREATE TABLE IF NOT EXISTS student_progress_lessons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_progress_id UUID NOT NULL REFERENCES student_progress(id) ON DELETE CASCADE,
  lesson_number INTEGER NOT NULL CHECK (lesson_number >= 1 AND lesson_number <= 3),
  lesson_date DATE,
  teacher_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_progress_id, lesson_number)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_student_progress_lessons_student_progress_id ON student_progress_lessons(student_progress_id);

-- ============================================
-- RLS (Row Level Security) ポリシー
-- ============================================
ALTER TABLE exam_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE textbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE curriculum_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_textbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_textbook_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_textbook_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_progress_lessons ENABLE ROW LEVEL SECURITY;

-- すべてのユーザーに許可（認証・未認証問わず）
-- exam_types
DROP POLICY IF EXISTS "exam_types_allow_all_auth" ON exam_types;
CREATE POLICY "exam_types_allow_all_auth" ON exam_types
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "exam_types_allow_all_anon" ON exam_types;
CREATE POLICY "exam_types_allow_all_anon" ON exam_types
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- textbooks
DROP POLICY IF EXISTS "textbooks_allow_all_auth" ON textbooks;
CREATE POLICY "textbooks_allow_all_auth" ON textbooks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "textbooks_allow_all_anon" ON textbooks;
CREATE POLICY "textbooks_allow_all_anon" ON textbooks
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- curriculum_items
DROP POLICY IF EXISTS "curriculum_items_allow_all_auth" ON curriculum_items;
CREATE POLICY "curriculum_items_allow_all_auth" ON curriculum_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "curriculum_items_allow_all_anon" ON curriculum_items;
CREATE POLICY "curriculum_items_allow_all_anon" ON curriculum_items
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- student_textbooks
DROP POLICY IF EXISTS "student_textbooks_allow_all_auth" ON student_textbooks;
CREATE POLICY "student_textbooks_allow_all_auth" ON student_textbooks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "student_textbooks_allow_all_anon" ON student_textbooks;
CREATE POLICY "student_textbooks_allow_all_anon" ON student_textbooks
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- student_textbook_settings
DROP POLICY IF EXISTS "student_textbook_settings_allow_all_auth" ON student_textbook_settings;
CREATE POLICY "student_textbook_settings_allow_all_auth" ON student_textbook_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "student_textbook_settings_allow_all_anon" ON student_textbook_settings;
CREATE POLICY "student_textbook_settings_allow_all_anon" ON student_textbook_settings
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- student_textbook_exams
DROP POLICY IF EXISTS "student_textbook_exams_allow_all_auth" ON student_textbook_exams;
CREATE POLICY "student_textbook_exams_allow_all_auth" ON student_textbook_exams
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "student_textbook_exams_allow_all_anon" ON student_textbook_exams;
CREATE POLICY "student_textbook_exams_allow_all_anon" ON student_textbook_exams
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- student_progress
DROP POLICY IF EXISTS "student_progress_allow_all_auth" ON student_progress;
CREATE POLICY "student_progress_allow_all_auth" ON student_progress
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "student_progress_allow_all_anon" ON student_progress;
CREATE POLICY "student_progress_allow_all_anon" ON student_progress
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- student_progress_lessons
DROP POLICY IF EXISTS "student_progress_lessons_allow_all_auth" ON student_progress_lessons;
CREATE POLICY "student_progress_lessons_allow_all_auth" ON student_progress_lessons
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "student_progress_lessons_allow_all_anon" ON student_progress_lessons;
CREATE POLICY "student_progress_lessons_allow_all_anon" ON student_progress_lessons
  FOR ALL TO anon USING (true) WITH CHECK (true);
