-- 進行表に「宿題未実施」「遅刻」フラグを追加
ALTER TABLE student_progress
  ADD COLUMN IF NOT EXISTS homework_not_done BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tardy BOOLEAN NOT NULL DEFAULT false;
