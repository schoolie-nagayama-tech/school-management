-- 講習期間シフト提出機能：4テーブル
-- seasonal_shift_settings, seasonal_shift_closed_dates, seasonal_shift_submissions, seasonal_shift_submission_slots

-- ============================================
-- 1. seasonal_shift_settings（シフト設定）
-- ============================================
CREATE TABLE IF NOT EXISTS seasonal_shift_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  deadline DATE NOT NULL,
  description TEXT DEFAULT '',
  weekday_slots TEXT NOT NULL DEFAULT '',
  saturday_slots TEXT NOT NULL DEFAULT '',
  saturday_open_slots TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seasonal_shift_settings_school_id ON seasonal_shift_settings(school_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_shift_settings_status ON seasonal_shift_settings(status);

DROP TRIGGER IF EXISTS update_seasonal_shift_settings_updated_at ON seasonal_shift_settings;
CREATE TRIGGER update_seasonal_shift_settings_updated_at
  BEFORE UPDATE ON seasonal_shift_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 2. seasonal_shift_closed_dates（休校日設定）
-- ============================================
CREATE TABLE IF NOT EXISTS seasonal_shift_closed_dates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_id UUID NOT NULL REFERENCES seasonal_shift_settings(id) ON DELETE CASCADE,
  closed_date DATE,
  day_of_week INTEGER CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)),
  closed_slots TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_date_or_dow CHECK (
    (closed_date IS NOT NULL AND day_of_week IS NULL) OR
    (closed_date IS NULL AND day_of_week IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_seasonal_shift_closed_dates_setting_id ON seasonal_shift_closed_dates(setting_id);

-- ============================================
-- 3. seasonal_shift_submissions（シフト提出）
-- ============================================
CREATE TABLE IF NOT EXISTS seasonal_shift_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_id UUID NOT NULL REFERENCES seasonal_shift_settings(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_seasonal_shift_submissions_setting_id ON seasonal_shift_submissions(setting_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_shift_submissions_school_id ON seasonal_shift_submissions(school_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_shift_submissions_edit_token ON seasonal_shift_submissions(edit_token);

DROP TRIGGER IF EXISTS update_seasonal_shift_submissions_updated_at ON seasonal_shift_submissions;
CREATE TRIGGER update_seasonal_shift_submissions_updated_at
  BEFORE UPDATE ON seasonal_shift_submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 4. seasonal_shift_submission_slots（提出シフト詳細）
-- ============================================
CREATE TABLE IF NOT EXISTS seasonal_shift_submission_slots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES seasonal_shift_submissions(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  time_slot TEXT NOT NULL,
  available BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seasonal_shift_slots_submission_id ON seasonal_shift_submission_slots(submission_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seasonal_shift_slots_unique ON seasonal_shift_submission_slots(submission_id, shift_date, time_slot);

-- ============================================
-- RLS
-- ============================================
ALTER TABLE seasonal_shift_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasonal_shift_closed_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasonal_shift_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasonal_shift_submission_slots ENABLE ROW LEVEL SECURITY;

-- 認証ユーザーは全操作可能（管理者は user_schools で教室に紐づく）
DROP POLICY IF EXISTS "seasonal_shift_settings_auth" ON seasonal_shift_settings;
CREATE POLICY "seasonal_shift_settings_auth" ON seasonal_shift_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "seasonal_shift_closed_dates_auth" ON seasonal_shift_closed_dates;
CREATE POLICY "seasonal_shift_closed_dates_auth" ON seasonal_shift_closed_dates FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "seasonal_shift_submissions_auth" ON seasonal_shift_submissions;
CREATE POLICY "seasonal_shift_submissions_auth" ON seasonal_shift_submissions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 匿名は提出の INSERT と 公開設定の SELECT のみ（提出フォーム用）
DROP POLICY IF EXISTS "seasonal_shift_submissions_anon_insert" ON seasonal_shift_submissions;
CREATE POLICY "seasonal_shift_submissions_anon_insert" ON seasonal_shift_submissions FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "seasonal_shift_slots_auth" ON seasonal_shift_submission_slots;
CREATE POLICY "seasonal_shift_slots_auth" ON seasonal_shift_submission_slots FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "seasonal_shift_slots_anon_insert" ON seasonal_shift_submission_slots;
CREATE POLICY "seasonal_shift_slots_anon_insert" ON seasonal_shift_submission_slots FOR INSERT TO anon WITH CHECK (true);

-- 公開中の設定を匿名が読める（提出フォームで設定・時間帯取得用）
DROP POLICY IF EXISTS "seasonal_shift_settings_anon_select_published" ON seasonal_shift_settings;
CREATE POLICY "seasonal_shift_settings_anon_select_published" ON seasonal_shift_settings
  FOR SELECT TO anon USING (status = 'published');

-- 休校設定は公開設定に紐づくので匿名が読める
DROP POLICY IF EXISTS "seasonal_shift_closed_dates_anon_select" ON seasonal_shift_closed_dates;
CREATE POLICY "seasonal_shift_closed_dates_anon_select" ON seasonal_shift_closed_dates FOR SELECT TO anon USING (true);

-- 修正用トークンで提出を取得・更新するため、anon で submission の SELECT/UPDATE を許可（edit_token 一致時はアプリ側で制御）
DROP POLICY IF EXISTS "seasonal_shift_submissions_anon_select" ON seasonal_shift_submissions;
CREATE POLICY "seasonal_shift_submissions_anon_select" ON seasonal_shift_submissions FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "seasonal_shift_submissions_anon_update" ON seasonal_shift_submissions;
CREATE POLICY "seasonal_shift_submissions_anon_update" ON seasonal_shift_submissions FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "seasonal_shift_slots_anon_select" ON seasonal_shift_submission_slots;
CREATE POLICY "seasonal_shift_slots_anon_select" ON seasonal_shift_submission_slots FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "seasonal_shift_slots_anon_update" ON seasonal_shift_submission_slots;
CREATE POLICY "seasonal_shift_slots_anon_update" ON seasonal_shift_submission_slots FOR UPDATE TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "seasonal_shift_slots_anon_delete" ON seasonal_shift_submission_slots;
CREATE POLICY "seasonal_shift_slots_anon_delete" ON seasonal_shift_submission_slots FOR DELETE TO anon USING (true);
