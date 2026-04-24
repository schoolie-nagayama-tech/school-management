-- 既存の portal_menu のタイトル/説明を新しいデフォルト名に更新
-- 旧デフォルトのまま残っている教室のみ対象（管理者がカスタム編集したタイトルは温存）

-- 増コマ申込 → テスト対策増コマ申し込み
UPDATE portal_menu
SET
  title = 'テスト対策増コマ申し込み',
  description = '定期テスト対策の追加授業のお申込みはこちら'
WHERE menu_key = 'zoukoma'
  AND title IN ('増コマ申し込み', '増コマ申込');

-- 模試申込 → オープン模試申し込み
UPDATE portal_menu
SET
  title = 'オープン模試申し込み',
  description = 'オープン模試のお申込みはこちら'
WHERE menu_key = 'moshi'
  AND title IN ('模試申し込み', '模試申込');
