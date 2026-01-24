-- application_itemsテーブルにteacher_editableカラムを追加
ALTER TABLE application_items 
ADD COLUMN IF NOT EXISTS teacher_editable BOOLEAN NOT NULL DEFAULT false;

-- 既存データはすべてfalse（講師は編集不可）として設定
UPDATE application_items 
SET teacher_editable = false 
WHERE teacher_editable IS NULL;
