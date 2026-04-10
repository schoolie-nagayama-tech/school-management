-- 講習シフト提出に「座席表入力」フラグを追加
ALTER TABLE seasonal_shift_submissions
  ADD COLUMN IF NOT EXISTS seat_chart_entered BOOLEAN NOT NULL DEFAULT false;
