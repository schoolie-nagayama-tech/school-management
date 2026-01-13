-- フォーム回答と期間のアーカイブ機能追加

-- form_responses テーブルにアーカイブ関連カラムを追加
ALTER TABLE form_responses 
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;

ALTER TABLE form_responses 
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE;

-- form_periods テーブルにアーカイブ関連カラムを追加
ALTER TABLE form_periods 
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;

ALTER TABLE form_periods 
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE;

-- インデックス追加（form_responses）
CREATE INDEX IF NOT EXISTS idx_form_responses_is_archived 
ON form_responses(is_archived);

CREATE INDEX IF NOT EXISTS idx_form_responses_school_type_archived 
ON form_responses(school_id, form_type, is_archived);

-- インデックス追加（form_periods）
CREATE INDEX IF NOT EXISTS idx_form_periods_is_archived 
ON form_periods(is_archived);

-- 既存データの初期化
UPDATE form_responses SET is_archived = FALSE WHERE is_archived IS NULL;
UPDATE form_periods SET is_archived = FALSE WHERE is_archived IS NULL;
