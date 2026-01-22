-- application_items に列タイプと期日を追加
-- student_applications に数値と日付の値を追加

-- application_items に列タイプと期日を追加
ALTER TABLE application_items 
ADD COLUMN IF NOT EXISTS column_type TEXT DEFAULT 'check' 
CHECK (column_type IN ('check', 'number', 'date'));

ALTER TABLE application_items 
ADD COLUMN IF NOT EXISTS due_date DATE;

-- student_applications に数値と日付の値を追加
ALTER TABLE student_applications 
ADD COLUMN IF NOT EXISTS number_value NUMERIC;

ALTER TABLE student_applications 
ADD COLUMN IF NOT EXISTS date_value DATE;

-- statusのNULL許可
ALTER TABLE student_applications 
DROP CONSTRAINT IF EXISTS student_applications_status_check;

ALTER TABLE student_applications 
ALTER COLUMN status DROP NOT NULL;

ALTER TABLE student_applications 
ADD CONSTRAINT student_applications_status_check 
CHECK (status IS NULL OR status IN ('pending', 'completed', 'not_applicable'));
