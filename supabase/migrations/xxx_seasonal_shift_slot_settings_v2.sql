-- 講習期間シフト v2: closed_dates 廃止、開講コマ設定テーブル追加

-- 1. 休校日テーブルを削除
DROP TABLE IF EXISTS seasonal_shift_closed_dates;

-- 2. 開講コマ設定テーブルを作成
CREATE TABLE seasonal_shift_slot_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_id UUID NOT NULL REFERENCES seasonal_shift_settings(id) ON DELETE CASCADE,
  slot_date DATE NOT NULL,
  time_slot TEXT NOT NULL,
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(setting_id, slot_date, time_slot)
);

CREATE INDEX idx_seasonal_shift_slot_settings_setting ON seasonal_shift_slot_settings(setting_id);

ALTER TABLE seasonal_shift_slot_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seasonal_shift_slot_settings_auth" ON seasonal_shift_slot_settings;
CREATE POLICY "seasonal_shift_slot_settings_auth" ON seasonal_shift_slot_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 公開設定に紐づくので匿名が読める（講師フォーム用）
DROP POLICY IF EXISTS "seasonal_shift_slot_settings_anon_select" ON seasonal_shift_slot_settings;
CREATE POLICY "seasonal_shift_slot_settings_anon_select" ON seasonal_shift_slot_settings FOR SELECT TO anon USING (true);

-- 3. seasonal_shift_settings から saturday_open_slots を削除
ALTER TABLE seasonal_shift_settings DROP COLUMN IF EXISTS saturday_open_slots;
