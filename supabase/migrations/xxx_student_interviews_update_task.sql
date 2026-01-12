-- 既存のstudent_interviewsテーブルにタスク機能を追加するマイグレーション
-- 既にテーブルが存在する場合に実行

-- interview_type に 'task' を追加
ALTER TABLE student_interviews 
DROP CONSTRAINT IF EXISTS student_interviews_interview_type_check;

ALTER TABLE student_interviews 
ADD CONSTRAINT student_interviews_interview_type_check 
CHECK (interview_type IN (
  'parent_interview', 'phone', 'student_interview', 
  'casual', 'enrollment', 'other', 'task'
));

-- タスク完了フラグを追加
ALTER TABLE student_interviews 
ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT FALSE;

-- タスク完了日時を追加
ALTER TABLE student_interviews 
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

-- 既存データの更新（is_completedをfalseに）
UPDATE student_interviews 
SET is_completed = FALSE 
WHERE is_completed IS NULL;
