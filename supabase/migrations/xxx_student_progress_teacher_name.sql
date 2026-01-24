-- student_progressテーブルにteacher_nameカラムを追加
ALTER TABLE student_progress 
ADD COLUMN IF NOT EXISTS teacher_name TEXT;
