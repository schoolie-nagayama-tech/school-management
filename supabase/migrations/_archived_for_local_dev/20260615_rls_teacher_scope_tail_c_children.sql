-- ============================================================
-- 講師リリース準備①(テールC): school_id を持たない子テーブルを親経由で教室スコープに
--
-- - progress_sessions          : student_textbook_id -> student_textbooks.school_id
-- - student_subjects           : student_id -> students.school_id
-- - seasonal_course_applications: course_id -> seasonal_courses.school_id
-- ============================================================

BEGIN;

-- progress_sessions (student_textbook_id -> student_textbooks)
DROP POLICY IF EXISTS "progress_sessions_allow_all_auth" ON public.progress_sessions;
CREATE POLICY "progress_sessions_school_scope_auth" ON public.progress_sessions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.student_textbooks st WHERE st.id = progress_sessions.student_textbook_id AND public.check_school_access(st.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.student_textbooks st WHERE st.id = progress_sessions.student_textbook_id AND public.check_school_access(st.school_id)));

-- student_subjects (student_id -> students)
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.student_subjects;
DROP POLICY IF EXISTS "student_subjects_allow_all_auth" ON public.student_subjects;
CREATE POLICY "student_subjects_school_scope_auth" ON public.student_subjects FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_subjects.student_id AND public.check_school_access(s.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_subjects.student_id AND public.check_school_access(s.school_id)));

-- seasonal_course_applications (course_id -> seasonal_courses)
DROP POLICY IF EXISTS "seasonal_course_applications_authenticated_all" ON public.seasonal_course_applications;
CREATE POLICY "seasonal_course_applications_school_scope_auth" ON public.seasonal_course_applications FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.seasonal_courses c WHERE c.id = seasonal_course_applications.course_id AND public.check_school_access(c.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.seasonal_courses c WHERE c.id = seasonal_course_applications.course_id AND public.check_school_access(c.school_id)));

COMMIT;
