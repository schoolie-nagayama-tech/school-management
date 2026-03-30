-- RLSポリシー修正: FOR ALLを操作別ポリシーに置き換え（INSERT時のWITH CHECK対応）
-- 冪等実行対応: 旧FOR ALLポリシーと新per-operationポリシーの両方をDROP

-- 旧 FOR ALL ポリシーを削除
DROP POLICY IF EXISTS "prep_periods_all" ON course_prep_periods;
DROP POLICY IF EXISTS "prep_items_all" ON course_prep_progress_items;
DROP POLICY IF EXISTS "prep_student_progress_all" ON course_prep_student_progress;
DROP POLICY IF EXISTS "prep_schedule_tasks_all" ON course_prep_schedule_tasks;
DROP POLICY IF EXISTS "prep_schedule_markers_all" ON course_prep_schedule_markers;
DROP POLICY IF EXISTS "prep_templates_all" ON course_prep_templates;

-- 新 per-operation ポリシーも念のため削除（再実行対応）
DROP POLICY IF EXISTS "prep_periods_select" ON course_prep_periods;
DROP POLICY IF EXISTS "prep_periods_insert" ON course_prep_periods;
DROP POLICY IF EXISTS "prep_periods_update" ON course_prep_periods;
DROP POLICY IF EXISTS "prep_periods_delete" ON course_prep_periods;

DROP POLICY IF EXISTS "prep_items_select" ON course_prep_progress_items;
DROP POLICY IF EXISTS "prep_items_insert" ON course_prep_progress_items;
DROP POLICY IF EXISTS "prep_items_update" ON course_prep_progress_items;
DROP POLICY IF EXISTS "prep_items_delete" ON course_prep_progress_items;

DROP POLICY IF EXISTS "prep_student_select" ON course_prep_student_progress;
DROP POLICY IF EXISTS "prep_student_insert" ON course_prep_student_progress;
DROP POLICY IF EXISTS "prep_student_update" ON course_prep_student_progress;
DROP POLICY IF EXISTS "prep_student_delete" ON course_prep_student_progress;

DROP POLICY IF EXISTS "prep_tasks_select" ON course_prep_schedule_tasks;
DROP POLICY IF EXISTS "prep_tasks_insert" ON course_prep_schedule_tasks;
DROP POLICY IF EXISTS "prep_tasks_update" ON course_prep_schedule_tasks;
DROP POLICY IF EXISTS "prep_tasks_delete" ON course_prep_schedule_tasks;

DROP POLICY IF EXISTS "prep_markers_select" ON course_prep_schedule_markers;
DROP POLICY IF EXISTS "prep_markers_insert" ON course_prep_schedule_markers;
DROP POLICY IF EXISTS "prep_markers_update" ON course_prep_schedule_markers;
DROP POLICY IF EXISTS "prep_markers_delete" ON course_prep_schedule_markers;

DROP POLICY IF EXISTS "prep_templates_select" ON course_prep_templates;
DROP POLICY IF EXISTS "prep_templates_insert" ON course_prep_templates;
DROP POLICY IF EXISTS "prep_templates_update" ON course_prep_templates;
DROP POLICY IF EXISTS "prep_templates_delete" ON course_prep_templates;

-- course_prep_periods
CREATE POLICY "prep_periods_select" ON course_prep_periods FOR SELECT USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_periods_insert" ON course_prep_periods FOR INSERT WITH CHECK (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_periods_update" ON course_prep_periods FOR UPDATE USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_periods_delete" ON course_prep_periods FOR DELETE USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);

-- course_prep_progress_items
CREATE POLICY "prep_items_select" ON course_prep_progress_items FOR SELECT USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_items_insert" ON course_prep_progress_items FOR INSERT WITH CHECK (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_items_update" ON course_prep_progress_items FOR UPDATE USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_items_delete" ON course_prep_progress_items FOR DELETE USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);

-- course_prep_student_progress
CREATE POLICY "prep_student_select" ON course_prep_student_progress FOR SELECT USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_student_insert" ON course_prep_student_progress FOR INSERT WITH CHECK (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_student_update" ON course_prep_student_progress FOR UPDATE USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_student_delete" ON course_prep_student_progress FOR DELETE USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);

-- course_prep_schedule_tasks
CREATE POLICY "prep_tasks_select" ON course_prep_schedule_tasks FOR SELECT USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_tasks_insert" ON course_prep_schedule_tasks FOR INSERT WITH CHECK (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_tasks_update" ON course_prep_schedule_tasks FOR UPDATE USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_tasks_delete" ON course_prep_schedule_tasks FOR DELETE USING (
  school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);

-- course_prep_schedule_markers
CREATE POLICY "prep_markers_select" ON course_prep_schedule_markers FOR SELECT USING (
  task_id IN (
    SELECT id FROM course_prep_schedule_tasks
    WHERE school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
  )
);
CREATE POLICY "prep_markers_insert" ON course_prep_schedule_markers FOR INSERT WITH CHECK (
  task_id IN (
    SELECT id FROM course_prep_schedule_tasks
    WHERE school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
  )
);
CREATE POLICY "prep_markers_update" ON course_prep_schedule_markers FOR UPDATE USING (
  task_id IN (
    SELECT id FROM course_prep_schedule_tasks
    WHERE school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
  )
);
CREATE POLICY "prep_markers_delete" ON course_prep_schedule_markers FOR DELETE USING (
  task_id IN (
    SELECT id FROM course_prep_schedule_tasks
    WHERE school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
  )
);

-- course_prep_templates
CREATE POLICY "prep_templates_select" ON course_prep_templates FOR SELECT USING (
  school_id IS NULL OR school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_templates_insert" ON course_prep_templates FOR INSERT WITH CHECK (
  school_id IS NULL OR school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_templates_update" ON course_prep_templates FOR UPDATE USING (
  school_id IS NULL OR school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
CREATE POLICY "prep_templates_delete" ON course_prep_templates FOR DELETE USING (
  school_id IS NULL OR school_id IN (SELECT school_id FROM user_schools WHERE user_id = auth.uid())
);
