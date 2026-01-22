-- 連絡掲示板テーブル

-- ラベルマスタ
CREATE TABLE IF NOT EXISTS bulletin_labels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#ff8e3c',  -- 表示色（HEX）
  is_system BOOLEAN NOT NULL DEFAULT false,  -- システム定義（削除不可）
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, name)
);

-- 投稿テーブル
CREATE TABLE IF NOT EXISTS bulletin_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  label_id UUID REFERENCES bulletin_labels(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false,  -- ピン留め（常に上部表示）
  is_archived BOOLEAN NOT NULL DEFAULT false,  -- アーカイブ済み
  archived_at TIMESTAMPTZ,
  created_by UUID REFERENCES user_profiles(id),
  updated_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 既読記録
CREATE TABLE IF NOT EXISTS bulletin_reads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES bulletin_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_bulletin_labels_school ON bulletin_labels(school_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_bulletin_posts_school ON bulletin_posts(school_id, is_archived, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bulletin_posts_pinned ON bulletin_posts(school_id, is_pinned, created_at DESC) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_bulletin_reads_post ON bulletin_reads(post_id);
CREATE INDEX IF NOT EXISTS idx_bulletin_reads_user ON bulletin_reads(user_id);

-- RLS
ALTER TABLE bulletin_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulletin_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulletin_reads ENABLE ROW LEVEL SECURITY;

-- 既存ポリシーを削除してから作成
DROP POLICY IF EXISTS "bulletin_labels_allow_all_auth" ON bulletin_labels;
DROP POLICY IF EXISTS "bulletin_labels_allow_all_anon" ON bulletin_labels;
CREATE POLICY "bulletin_labels_allow_all_auth" ON bulletin_labels
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "bulletin_labels_allow_all_anon" ON bulletin_labels
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "bulletin_posts_allow_all_auth" ON bulletin_posts;
DROP POLICY IF EXISTS "bulletin_posts_allow_all_anon" ON bulletin_posts;
CREATE POLICY "bulletin_posts_allow_all_auth" ON bulletin_posts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "bulletin_posts_allow_all_anon" ON bulletin_posts
  FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "bulletin_reads_allow_all_auth" ON bulletin_reads;
DROP POLICY IF EXISTS "bulletin_reads_allow_all_anon" ON bulletin_reads;
CREATE POLICY "bulletin_reads_allow_all_auth" ON bulletin_reads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "bulletin_reads_allow_all_anon" ON bulletin_reads
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- updated_atトリガー
DROP TRIGGER IF EXISTS update_bulletin_labels_updated_at ON bulletin_labels;
CREATE TRIGGER update_bulletin_labels_updated_at
  BEFORE UPDATE ON bulletin_labels
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_bulletin_posts_updated_at ON bulletin_posts;
CREATE TRIGGER update_bulletin_posts_updated_at
  BEFORE UPDATE ON bulletin_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 既存の教室にデフォルトラベルを追加（存在しない場合のみ）
DO $$
DECLARE
  school_record RECORD;
  label_exists BOOLEAN;
BEGIN
  FOR school_record IN SELECT id FROM schools LOOP
    -- 重要ラベルの存在確認
    SELECT EXISTS(SELECT 1 FROM bulletin_labels WHERE school_id = school_record.id AND name = '重要') INTO label_exists;
    IF NOT label_exists THEN
      INSERT INTO bulletin_labels (school_id, name, color, is_system, sort_order)
      VALUES (school_record.id, '重要', '#d9376e', true, 0);
    END IF;
    
    -- 通常ラベルの存在確認
    SELECT EXISTS(SELECT 1 FROM bulletin_labels WHERE school_id = school_record.id AND name = '通常') INTO label_exists;
    IF NOT label_exists THEN
      INSERT INTO bulletin_labels (school_id, name, color, is_system, sort_order)
      VALUES (school_record.id, '通常', '#2a2a2a', true, 1);
    END IF;
  END LOOP;
END $$;
