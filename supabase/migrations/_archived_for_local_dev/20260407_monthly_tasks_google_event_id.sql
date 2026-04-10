-- monthly_tasks に Google Calendar イベントID を追加
ALTER TABLE monthly_tasks ADD COLUMN IF NOT EXISTS google_event_id TEXT;
