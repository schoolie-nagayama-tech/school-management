-- formsテーブルにis_archivedカラムを追加
ALTER TABLE forms 
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

-- archived_atカラムも追加
ALTER TABLE forms 
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- インデックスを追加
CREATE INDEX IF NOT EXISTS idx_forms_is_archived ON forms(is_archived);
