-- portal_menu に link_type と link_urls を追加（既存DB用）
-- Supabase Dashboard > SQL Editor で実行するか、supabase db push で適用

-- link_type が無い場合のみ追加
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'portal_menu' AND column_name = 'link_type'
  ) THEN
    ALTER TABLE portal_menu
      ADD COLUMN link_type TEXT DEFAULT 'external' CHECK (link_type IN ('internal', 'external'));
    ALTER TABLE portal_menu ALTER COLUMN link_type SET NOT NULL;
    UPDATE portal_menu SET link_type = 'external' WHERE link_type IS NULL;
  END IF;
END $$;

-- link_urls が無い場合のみ追加
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'portal_menu' AND column_name = 'link_urls'
  ) THEN
    ALTER TABLE portal_menu ADD COLUMN link_urls JSONB DEFAULT NULL;
    CREATE INDEX IF NOT EXISTS idx_portal_menu_link_urls ON portal_menu USING GIN (link_urls);
  END IF;
END $$;
