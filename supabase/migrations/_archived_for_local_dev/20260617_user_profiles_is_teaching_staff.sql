-- owner/admin/manager でも時給で授業を持つスタッフを「講師としても」管理するためのフラグ。
-- 出勤簿などの講師抽出を role='teacher' に加えてこのフラグONのユーザーも含める。
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_teaching_staff boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN user_profiles.is_teaching_staff IS 'true=ロールに関わらず時給講師として扱い、出勤簿・講師一覧などに含める（owner/adminが授業も持つ場合に使用）';
