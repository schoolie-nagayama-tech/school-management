-- student_textbooksテーブルにseasonカラムを追加
-- Supabase SQL Editorで実行してください

-- seasonカラムを追加（既に存在する場合はスキップ）
ALTER TABLE student_textbooks ADD COLUMN IF NOT EXISTS season VARCHAR(10) CHECK (season IS NULL OR season IN ('spring', 'summer', 'winter'));

-- インデックス（オプション）
CREATE INDEX IF NOT EXISTS idx_student_textbooks_season ON student_textbooks(season) WHERE season IS NOT NULL;
