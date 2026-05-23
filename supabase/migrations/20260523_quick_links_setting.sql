-- クイックリンク（生徒管理ページ上部の外部ツール用ショートカット）の初期設定を挿入
-- value は JSON 文字列で QuickLink[] を保存する
INSERT INTO system_settings (key, value, description, category, created_at, updated_at)
VALUES (
  'quick_links',
  '[]',
  '生徒管理ページ上部に表示する外部ツールへのクイックリンク（全教室共通）',
  'ui',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
