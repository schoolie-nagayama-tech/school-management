-- Add 'subject_proposal' to auto_source CHECK constraint
ALTER TABLE course_prep_progress_items
  DROP CONSTRAINT IF EXISTS course_prep_progress_items_auto_source_check;

ALTER TABLE course_prep_progress_items
  ADD CONSTRAINT course_prep_progress_items_auto_source_check
  CHECK (auto_source IN ('regular_weekly', 'course_sessions', 'proposed_extra', 'subject_proposal'));
