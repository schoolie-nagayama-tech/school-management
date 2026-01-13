-- 申込項目テーブルに非表示機能を追加
ALTER TABLE application_items 
ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;

-- 終了日を追加
ALTER TABLE application_items 
ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP WITH TIME ZONE;

-- インデックス追加
CREATE INDEX IF NOT EXISTS idx_application_items_is_hidden 
ON application_items(is_hidden);

-- 既存データの更新
UPDATE application_items 
SET is_hidden = FALSE 
WHERE is_hidden IS NULL;

-- student_applications に CASCADE 削除を設定（まだの場合）
ALTER TABLE student_applications
DROP CONSTRAINT IF EXISTS student_applications_item_id_fkey;

ALTER TABLE student_applications
ADD CONSTRAINT student_applications_item_id_fkey
FOREIGN KEY (item_id) REFERENCES application_items(id) ON DELETE CASCADE;
