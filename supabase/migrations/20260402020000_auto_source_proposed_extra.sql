-- auto_sourceに'proposed_extra'を追加
ALTER TABLE course_prep_progress_items
  DROP CONSTRAINT IF EXISTS course_prep_progress_items_auto_source_check;

ALTER TABLE course_prep_progress_items
  ADD CONSTRAINT course_prep_progress_items_auto_source_check
  CHECK (auto_source IN ('regular_weekly', 'course_sessions', 'proposed_extra'));
