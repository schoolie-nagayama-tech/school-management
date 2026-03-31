-- form_responses に form_id カラムを追加（フォーム期間との紐付け用）
ALTER TABLE form_responses
  ADD COLUMN IF NOT EXISTS form_id uuid DEFAULT NULL;

-- notification_sent_at が無い場合も追加（別マイグレーションで追加済みだが念のため）
ALTER TABLE form_responses
  ADD COLUMN IF NOT EXISTS notification_sent_at timestamptz DEFAULT NULL;
