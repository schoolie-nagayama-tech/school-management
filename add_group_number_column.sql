-- student_progress テーブルに group_number カラムを追加
-- Supabase SQL Editorで実行してください

-- group_numberカラムを追加（既に存在する場合はスキップ）
ALTER TABLE student_progress ADD COLUMN IF NOT EXISTS group_number INT DEFAULT NULL;

-- インデックス追加（グループ検索用）
CREATE INDEX IF NOT EXISTS idx_student_progress_group ON student_progress(student_textbook_id, group_number);
