-- フォーム申込通知の二重送信防止用：送信済み日時を記録
ALTER TABLE form_responses
  ADD COLUMN IF NOT EXISTS notification_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN form_responses.notification_sent_at IS '申込確認メール送信済み日時（二重送信防止）';
