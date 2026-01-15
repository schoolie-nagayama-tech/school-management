-- student_textbook_examsテーブルにcustom_exam_nameカラムを追加
-- Supabase SQL Editorで実行してください

-- custom_exam_nameカラムを追加（既に存在する場合はスキップ）
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
