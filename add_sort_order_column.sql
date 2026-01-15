-- student_textbooksテーブルにsort_orderカラムを追加
-- Supabase SQL Editorで実行してください

-- sort_orderカラムを追加（既に存在する場合はスキップ）
ALTER TABLE student_textbooks ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- 既存データにsort_orderを設定（created_at順）
UPDATE student_textbooks
SET sort_order = sub.row_num - 1
FROM (
  SELECT 
    id,
    ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY created_at) as row_num
  FROM student_textbooks
) AS sub
WHERE student_textbooks.id = sub.id;

-- インデックス（オプション）
CREATE INDEX IF NOT EXISTS idx_student_textbooks_sort_order ON student_textbooks(student_id, sort_order);
