-- 複数教室のときのデフォルト教室（ログイン時の初期選択に使用）
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS default_school_id UUID REFERENCES schools(id) ON DELETE SET NULL;

COMMENT ON COLUMN user_profiles.default_school_id IS '複数教室権限があるときのデフォルト教室（ログイン時の初期選択）';
