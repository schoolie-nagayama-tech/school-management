-- Add target_koma column to course_prep_periods
ALTER TABLE course_prep_periods
  ADD COLUMN IF NOT EXISTS target_koma integer NOT NULL DEFAULT 0;
