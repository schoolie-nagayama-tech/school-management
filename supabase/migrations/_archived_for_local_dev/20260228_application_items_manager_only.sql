-- 室長以上のみ表示する列（講師には非表示）
ALTER TABLE application_items
ADD COLUMN IF NOT EXISTS manager_only BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN application_items.manager_only IS 'true: 室長権限以上のみ表示（講師には非表示）';
