-- 講師の社員番号（オーナーが全教室横断で割り振る。出勤簿一覧の並び順制御に使用）
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS employee_no text;
COMMENT ON COLUMN user_profiles.employee_no IS '講師の社員番号。オーナーが割り振るグローバルな番号。出勤簿一覧の並び順に使用。NULL=未設定';
