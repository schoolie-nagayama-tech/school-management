-- 講師の曜日ごとの出勤可能コマ（1〜7限）。キーは曜日 0=日..6=土、値は slot_number の配列
-- 空オブジェクトまたは未設定 = 全コマ出勤可（従来どおり）
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS available_slot_numbers_by_day JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN user_profiles.available_slot_numbers_by_day IS '曜日ごとの出勤可能コマ番号。キー "0"〜"6"、値は 1〜7 の配列。空または未設定は全コマ可';
