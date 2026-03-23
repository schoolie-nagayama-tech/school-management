-- 通常シフト提出機能：4テーブル（曜日×時間帯マトリクス）
-- regular_shift_settings, regular_shift_slot_settings, regular_shift_submissions, regular_shift_submission_slots

-- ============================================
-- 1. regular_shift_settings（シフト設定）
-- ============================================
CREATE TABLE IF NOT EXISTS regular_shift_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  deadline DATE,
  description TEXT DEFAULT '',
  weekday_slots TEXT NOT NULL DEFAULT '',
  saturday_slots TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regular_shift_settings_school_id ON regular_shift_settings(school_id);
CREATE INDEX IF NOT EXISTS idx_regular_shift_settings_status ON regular_shift_settings(status);

DROP TRIGGER IF EXISTS update_regular_shift_settings_updated_at ON regular_shift_settings;
CREATE TRIGGER update_regular_shift_settings_updated_at
  BEFORE UPDATE ON regular_shift_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 2. regular_shift_slot_settings（開講コマ設定：曜日×時間帯）
-- ============================================
CREATE TABLE IF NOT EXISTS regular_shift_slot_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_id UUID NOT NULL REFERENCES regular_shift_settings(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  time_slot TEXT NOT NULL,
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(setting_id, day_of_week, time_slot)
);

CREATE INDEX IF NOT EXISTS idx_regular_shift_slot_settings_setting ON regular_shift_slot_settings(setting_id);

-- ============================================
-- 3. regular_shift_submissions（シフト提出）
-- ============================================
CREATE TABLE IF NOT EXISTS regular_shift_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_id UUID NOT NULL REFERENCES regular_shift_settings(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_name TEXT NOT NULL,
  teacher_email TEXT NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT DEFAULT '',
  allow_edit BOOLEAN NOT NULL DEFAULT FALSE,
  edit_token UUID DEFAULT gen_random_uuid() UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regular_shift_submissions_setting_id ON regular_shift_submissions(setting_id);
CREATE INDEX IF NOT EXISTS idx_regular_shift_submissions_school_id ON regular_shift_submissions(school_id);
CREATE INDEX IF NOT EXISTS idx_regular_shift_submissions_edit_token ON regular_shift_submissions(edit_token);

DROP TRIGGER IF EXISTS update_regular_shift_submissions_updated_at ON regular_shift_submissions;
CREATE TRIGGER update_regular_shift_submissions_updated_at
  BEFORE UPDATE ON regular_shift_submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 4. regular_shift_submission_slots（提出シフト詳細：曜日×時間帯）
-- ============================================
CREATE TABLE IF NOT EXISTS regular_shift_submission_slots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES regular_shift_submissions(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  time_slot TEXT NOT NULL,
  available BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regular_shift_slots_submission_id ON regular_shift_submission_slots(submission_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_regular_shift_slots_unique ON regular_shift_submission_slots(submission_id, day_of_week, time_slot);

-- ============================================
-- RLS
-- ============================================
ALTER TABLE regular_shift_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE regular_shift_slot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE regular_shift_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE regular_shift_submission_slots ENABLE ROW LEVEL SECURITY;

-- 認証ユーザーは全操作可能
DROP POLICY IF EXISTS "regular_shift_settings_auth" ON regular_shift_settings;
CREATE POLICY "regular_shift_settings_auth" ON regular_shift_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "regular_shift_slot_settings_auth" ON regular_shift_slot_settings;
CREATE POLICY "regular_shift_slot_settings_auth" ON regular_shift_slot_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "regular_shift_submissions_auth" ON regular_shift_submissions;
CREATE POLICY "regular_shift_submissions_auth" ON regular_shift_submissions FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "regular_shift_slots_auth" ON regular_shift_submission_slots;
CREATE POLICY "regular_shift_slots_auth" ON regular_shift_submission_slots FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 匿名は提出の INSERT（提出フォーム用）
DROP POLICY IF EXISTS "regular_shift_submissions_anon_insert" ON regular_shift_submissions;
CREATE POLICY "regular_shift_submissions_anon_insert" ON regular_shift_submissions FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "regular_shift_slots_anon_insert" ON regular_shift_submission_slots;
CREATE POLICY "regular_shift_slots_anon_insert" ON regular_shift_submission_slots FOR INSERT TO anon WITH CHECK (true);

-- 公開中の設定を匿名が読める（提出フォームで設定・時間帯取得用）
DROP POLICY IF EXISTS "regular_shift_settings_anon_select_published" ON regular_shift_settings;
CREATE POLICY "regular_shift_settings_anon_select_published" ON regular_shift_settings
  FOR SELECT TO anon USING (status = 'published');

-- 開講コマ設定は公開設定に紐づくので匿名が読める（講師フォーム用）
DROP POLICY IF EXISTS "regular_shift_slot_settings_anon_select" ON regular_shift_slot_settings;
CREATE POLICY "regular_shift_slot_settings_anon_select" ON regular_shift_slot_settings FOR SELECT TO anon USING (true);

-- 修正用トークンで提出を取得・更新するため、anon で submission の SELECT/UPDATE を許可
DROP POLICY IF EXISTS "regular_shift_submissions_anon_select" ON regular_shift_submissions;
CREATE POLICY "regular_shift_submissions_anon_select" ON regular_shift_submissions FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "regular_shift_submissions_anon_update" ON regular_shift_submissions;
CREATE POLICY "regular_shift_submissions_anon_update" ON regular_shift_submissions FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "regular_shift_slots_anon_select" ON regular_shift_submission_slots;
CREATE POLICY "regular_shift_slots_anon_select" ON regular_shift_submission_slots FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "regular_shift_slots_anon_update" ON regular_shift_submission_slots;
CREATE POLICY "regular_shift_slots_anon_update" ON regular_shift_submission_slots FOR UPDATE TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "regular_shift_slots_anon_delete" ON regular_shift_submission_slots;
CREATE POLICY "regular_shift_slots_anon_delete" ON regular_shift_submission_slots FOR DELETE TO anon USING (true);
