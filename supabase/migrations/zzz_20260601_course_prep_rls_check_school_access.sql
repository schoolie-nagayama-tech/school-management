-- course_prep_* 6テーブルのRLSを check_school_access() に揃える是正。
--
-- 背景: zzz_ RLS匿名ロックダウンで course_prep_* の SELECT/INSERT/UPDATE/DELETE が
--       生の user_schools 絞り込み（school_id IN (SELECT ... FROM user_schools ...)）になっており、
--       user_schools 所属の無い admin/owner/manager が講習期間等を一切参照できず、
--       座席表の講習モードが開けない回帰が発生していた。
-- 対応: schedule_entries 等と同じ check_school_access(school_id) に統一する。
--       check_school_access = admin/owner/manager は全校TRUE、それ以外は所属校のみ、anon(auth.uid()=null)はFALSE。
--       roles=public は据え置き（式のみ差替え。anon は引き続きブロック）。

-- 1. course_prep_periods（school_id 直）
DROP POLICY IF EXISTS prep_periods_select ON course_prep_periods;
DROP POLICY IF EXISTS prep_periods_insert ON course_prep_periods;
DROP POLICY IF EXISTS prep_periods_update ON course_prep_periods;
DROP POLICY IF EXISTS prep_periods_delete ON course_prep_periods;
CREATE POLICY prep_periods_select ON course_prep_periods FOR SELECT USING (check_school_access(school_id));
CREATE POLICY prep_periods_insert ON course_prep_periods FOR INSERT WITH CHECK (check_school_access(school_id));
CREATE POLICY prep_periods_update ON course_prep_periods FOR UPDATE USING (check_school_access(school_id)) WITH CHECK (check_school_access(school_id));
CREATE POLICY prep_periods_delete ON course_prep_periods FOR DELETE USING (check_school_access(school_id));

-- 2. course_prep_progress_items（school_id 直）
DROP POLICY IF EXISTS prep_items_select ON course_prep_progress_items;
DROP POLICY IF EXISTS prep_items_insert ON course_prep_progress_items;
DROP POLICY IF EXISTS prep_items_update ON course_prep_progress_items;
DROP POLICY IF EXISTS prep_items_delete ON course_prep_progress_items;
CREATE POLICY prep_items_select ON course_prep_progress_items FOR SELECT USING (check_school_access(school_id));
CREATE POLICY prep_items_insert ON course_prep_progress_items FOR INSERT WITH CHECK (check_school_access(school_id));
CREATE POLICY prep_items_update ON course_prep_progress_items FOR UPDATE USING (check_school_access(school_id)) WITH CHECK (check_school_access(school_id));
CREATE POLICY prep_items_delete ON course_prep_progress_items FOR DELETE USING (check_school_access(school_id));

-- 3. course_prep_schedule_tasks（school_id 直）
DROP POLICY IF EXISTS prep_tasks_select ON course_prep_schedule_tasks;
DROP POLICY IF EXISTS prep_tasks_insert ON course_prep_schedule_tasks;
DROP POLICY IF EXISTS prep_tasks_update ON course_prep_schedule_tasks;
DROP POLICY IF EXISTS prep_tasks_delete ON course_prep_schedule_tasks;
CREATE POLICY prep_tasks_select ON course_prep_schedule_tasks FOR SELECT USING (check_school_access(school_id));
CREATE POLICY prep_tasks_insert ON course_prep_schedule_tasks FOR INSERT WITH CHECK (check_school_access(school_id));
CREATE POLICY prep_tasks_update ON course_prep_schedule_tasks FOR UPDATE USING (check_school_access(school_id)) WITH CHECK (check_school_access(school_id));
CREATE POLICY prep_tasks_delete ON course_prep_schedule_tasks FOR DELETE USING (check_school_access(school_id));

-- 4. course_prep_student_progress（school_id 直）
DROP POLICY IF EXISTS prep_student_select ON course_prep_student_progress;
DROP POLICY IF EXISTS prep_student_insert ON course_prep_student_progress;
DROP POLICY IF EXISTS prep_student_update ON course_prep_student_progress;
DROP POLICY IF EXISTS prep_student_delete ON course_prep_student_progress;
CREATE POLICY prep_student_select ON course_prep_student_progress FOR SELECT USING (check_school_access(school_id));
CREATE POLICY prep_student_insert ON course_prep_student_progress FOR INSERT WITH CHECK (check_school_access(school_id));
CREATE POLICY prep_student_update ON course_prep_student_progress FOR UPDATE USING (check_school_access(school_id)) WITH CHECK (check_school_access(school_id));
CREATE POLICY prep_student_delete ON course_prep_student_progress FOR DELETE USING (check_school_access(school_id));

-- 5. course_prep_schedule_markers（school_id を直接持たず、親 task 経由）
DROP POLICY IF EXISTS prep_markers_select ON course_prep_schedule_markers;
DROP POLICY IF EXISTS prep_markers_insert ON course_prep_schedule_markers;
DROP POLICY IF EXISTS prep_markers_update ON course_prep_schedule_markers;
DROP POLICY IF EXISTS prep_markers_delete ON course_prep_schedule_markers;
CREATE POLICY prep_markers_select ON course_prep_schedule_markers FOR SELECT
  USING (task_id IN (SELECT t.id FROM course_prep_schedule_tasks t WHERE check_school_access(t.school_id)));
CREATE POLICY prep_markers_insert ON course_prep_schedule_markers FOR INSERT
  WITH CHECK (task_id IN (SELECT t.id FROM course_prep_schedule_tasks t WHERE check_school_access(t.school_id)));
CREATE POLICY prep_markers_update ON course_prep_schedule_markers FOR UPDATE
  USING (task_id IN (SELECT t.id FROM course_prep_schedule_tasks t WHERE check_school_access(t.school_id)))
  WITH CHECK (task_id IN (SELECT t.id FROM course_prep_schedule_tasks t WHERE check_school_access(t.school_id)));
CREATE POLICY prep_markers_delete ON course_prep_schedule_markers FOR DELETE
  USING (task_id IN (SELECT t.id FROM course_prep_schedule_tasks t WHERE check_school_access(t.school_id)));

-- 6. course_prep_templates（school_id NULL=全体共通 を許容）
DROP POLICY IF EXISTS prep_templates_select ON course_prep_templates;
DROP POLICY IF EXISTS prep_templates_insert ON course_prep_templates;
DROP POLICY IF EXISTS prep_templates_update ON course_prep_templates;
DROP POLICY IF EXISTS prep_templates_delete ON course_prep_templates;
CREATE POLICY prep_templates_select ON course_prep_templates FOR SELECT USING (school_id IS NULL OR check_school_access(school_id));
CREATE POLICY prep_templates_insert ON course_prep_templates FOR INSERT WITH CHECK (school_id IS NULL OR check_school_access(school_id));
CREATE POLICY prep_templates_update ON course_prep_templates FOR UPDATE USING (school_id IS NULL OR check_school_access(school_id)) WITH CHECK (school_id IS NULL OR check_school_access(school_id));
CREATE POLICY prep_templates_delete ON course_prep_templates FOR DELETE USING (school_id IS NULL OR check_school_access(school_id));
