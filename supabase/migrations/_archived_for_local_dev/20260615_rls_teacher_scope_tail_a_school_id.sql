-- ============================================================
-- 講師リリース準備①(テールA): school_id 直持ちテーブルを教室スコープRLSに
--
-- いずれも *_authenticated_all / *_all (USING true) のままで、認証済みユーザー
-- (講師含む)が他教室データを読み書きできた。check_school_access(school_id) に統一。
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "notta_transcripts_authenticated_all" ON public.notta_transcripts;
CREATE POLICY "notta_transcripts_school_scope_auth" ON public.notta_transcripts FOR ALL TO authenticated
  USING (public.check_school_access(school_id)) WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "authenticated users can manage koushu_enrollments" ON public.koushu_enrollments;
CREATE POLICY "koushu_enrollments_school_scope_auth" ON public.koushu_enrollments FOR ALL TO authenticated
  USING (public.check_school_access(school_id)) WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "seasonal_courses_authenticated_all" ON public.seasonal_courses;
CREATE POLICY "seasonal_courses_school_scope_auth" ON public.seasonal_courses FOR ALL TO authenticated
  USING (public.check_school_access(school_id)) WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "school_class_capacity_allow_all_auth" ON public.school_class_capacity;
CREATE POLICY "school_class_capacity_school_scope_auth" ON public.school_class_capacity FOR ALL TO authenticated
  USING (public.check_school_access(school_id)) WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "seasonal_shift_student_submissions_allow_all_auth" ON public.seasonal_shift_student_submissions;
CREATE POLICY "seasonal_shift_student_submissions_school_scope_auth" ON public.seasonal_shift_student_submissions FOR ALL TO authenticated
  USING (public.check_school_access(school_id)) WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "schedule_change_logs_all" ON public.schedule_change_logs;
CREATE POLICY "schedule_change_logs_school_scope_auth" ON public.schedule_change_logs FOR ALL TO authenticated
  USING (public.check_school_access(school_id)) WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "schedule_daily_booth_assignments_allow_all_auth" ON public.schedule_daily_booth_assignments;
CREATE POLICY "schedule_daily_booth_assignments_school_scope_auth" ON public.schedule_daily_booth_assignments FOR ALL TO authenticated
  USING (public.check_school_access(school_id)) WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "schedule_match_batches_allow_all_auth" ON public.schedule_match_batches;
CREATE POLICY "schedule_match_batches_school_scope_auth" ON public.schedule_match_batches FOR ALL TO authenticated
  USING (public.check_school_access(school_id)) WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "schedule_match_proposals_allow_all_auth" ON public.schedule_match_proposals;
CREATE POLICY "schedule_match_proposals_school_scope_auth" ON public.schedule_match_proposals FOR ALL TO authenticated
  USING (public.check_school_access(school_id)) WITH CHECK (public.check_school_access(school_id));

COMMIT;
