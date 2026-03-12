-- 通知メールアドレスの複数設定対応
-- notification_emails TEXT[] 列を追加し、既存の notification_email を配列に移行

ALTER TABLE schools
  ADD COLUMN notification_emails TEXT[] NOT NULL DEFAULT '{}';

-- 既存の single email を配列の先頭要素として移行
UPDATE schools
  SET notification_emails = ARRAY[notification_email]
  WHERE notification_email IS NOT NULL AND notification_email <> '';
