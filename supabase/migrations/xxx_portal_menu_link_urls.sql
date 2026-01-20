-- ポータルメニューに複数外部リンク対応を追加
-- link_urlsカラム（JSONB）を追加し、既存のlink_urlデータを移行

-- link_urlsカラムを追加
ALTER TABLE portal_menu 
ADD COLUMN IF NOT EXISTS link_urls JSONB DEFAULT NULL;

-- 既存のlink_urlデータをlink_urlsに移行（外部リンクの場合のみ）
-- link_urlが設定されている場合は、それを配列としてlink_urlsに保存
UPDATE portal_menu
SET link_urls = CASE
  WHEN link_type = 'external' AND link_url IS NOT NULL AND link_url != '' THEN
    jsonb_build_array(jsonb_build_object('url', link_url, 'label', title))
  ELSE
    NULL
END
WHERE link_urls IS NULL;

-- インデックスを追加（JSONB検索用）
CREATE INDEX IF NOT EXISTS idx_portal_menu_link_urls ON portal_menu USING GIN (link_urls);
