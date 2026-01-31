-- 講師の指導可能科目・出勤可能曜日（user_profiles に追加）
-- 0=日, 1=月, ..., 6=土（JavaScript getDay() に合わせる）
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS teachable_subject_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS available_days_of_week INTEGER[] DEFAULT '{1,2,3,4,5,6}';

COMMENT ON COLUMN user_profiles.teachable_subject_ids IS '指導可能な科目IDの配列（空の場合は全科目可）';
COMMENT ON COLUMN user_profiles.available_days_of_week IS '出勤可能曜日 0=日,1=月,...,6=土（空の場合は全曜日）';
