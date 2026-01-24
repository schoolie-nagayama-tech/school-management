-- schoolsテーブルに通知先メール追加
ALTER TABLE schools 
ADD COLUMN IF NOT EXISTS notification_email TEXT;

COMMENT ON COLUMN schools.notification_email IS '申込通知先メールアドレス';
