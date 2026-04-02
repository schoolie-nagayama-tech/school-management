-- 準備スケジュールタスクと進捗管理項目のリンク機能
-- schedule_task → progress_item の多対1リンク

ALTER TABLE course_prep_schedule_tasks
  ADD COLUMN linked_progress_item_id UUID
    REFERENCES course_prep_progress_items(id) ON DELETE SET NULL;

CREATE INDEX idx_prep_tasks_linked_item
  ON course_prep_schedule_tasks(linked_progress_item_id);
