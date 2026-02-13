-- システム設定テーブル（プライバシースクリーン等）
CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(255) UNIQUE NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  category VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_settings_category ON system_settings(category);
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_settings_allow_all_auth" ON system_settings;
DROP POLICY IF EXISTS "system_settings_allow_all_anon" ON system_settings;
CREATE POLICY "system_settings_allow_all_auth" ON system_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "system_settings_allow_all_anon" ON system_settings
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- プライバシースクリーン初期設定
INSERT INTO system_settings (key, value, description, category, created_at, updated_at)
VALUES (
  'privacy_screen_timeout',
  '60',
  'プライバシースクリーンが起動するまでの秒数',
  'security',
  NOW(),
  NOW()
), (
  'privacy_screen_enabled_roles',
  '["owner","manager"]',
  'プライバシースクリーンを適用するロールの一覧（JSON配列）',
  'security',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
