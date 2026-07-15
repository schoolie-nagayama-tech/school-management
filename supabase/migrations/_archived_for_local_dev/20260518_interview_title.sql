-- 面談記録にタイトルカラムを追加
ALTER TABLE student_interviews ADD COLUMN IF NOT EXISTS title TEXT;
