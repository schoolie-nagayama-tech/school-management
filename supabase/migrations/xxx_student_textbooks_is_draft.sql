-- student_textbooksテーブルにis_draftカラムを追加
-- 下書き機能：講師には見えない、教室長以上には見える

-- is_draftカラムを追加（デフォルトはfalse）
ALTER TABLE student_textbooks
ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT false NOT NULL;

-- 既存データはすべて公開状態（is_draft = false）として扱う
UPDATE student_textbooks
SET is_draft = false
WHERE is_draft IS NULL;

-- インデックスを追加（フィルタリング用）
CREATE INDEX IF NOT EXISTS idx_student_textbooks_is_draft ON student_textbooks(is_draft);
