-- ロール別タイムアウト設定（0=無効、正の数=秒数）
INSERT INTO system_settings (key, value, description, category, created_at, updated_at)
VALUES (
  'privacy_screen_timeout_by_role',
  '{"admin":0,"owner":60,"manager":60,"teacher":0,"parent":0}',
  'プライバシースクリーンのタイムアウト（秒）をロール別に設定。0は無効',
  'security',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
