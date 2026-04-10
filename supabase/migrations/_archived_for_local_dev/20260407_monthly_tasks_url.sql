-- monthly_tasks に URL カラムを追加（研修URL等）
ALTER TABLE monthly_tasks ADD COLUMN IF NOT EXISTS url TEXT;
