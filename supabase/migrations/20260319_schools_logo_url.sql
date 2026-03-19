-- schools テーブルにロゴURL カラムを追加
ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT NULL;

COMMENT ON COLUMN schools.logo_url IS '教室のロゴ画像URL（ポータルヘッダーに表示）';
