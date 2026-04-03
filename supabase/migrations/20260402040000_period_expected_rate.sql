-- Add expected_rate column to course_prep_periods (0-100 integer, represents %)
ALTER TABLE course_prep_periods
  ADD COLUMN IF NOT EXISTS expected_rate integer NOT NULL DEFAULT 0;
