-- 通常シフト提出に「座席表反映」フラグを追加
ALTER TABLE regular_shift_submissions
  ADD COLUMN IF NOT EXISTS seat_chart_entered BOOLEAN NOT NULL DEFAULT false;
