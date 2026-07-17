-- ============================================================
-- 講師リリース準備①(テールE): 進捗系・講習子・transfer_notifications を教室スコープに
--
-- いずれも internal 専用(匿名フロー無し)で *_allow_all_auth (USING true) のまま、
-- 認証済みユーザー(講師含む)が他教室データを読み書きできた。
--   - 進捗本体/目標/試験範囲/進め方設定: student_textbook_id -> student_textbooks.school_id
--   - action_goals       : student_textbook_exam_id -> student_textbook_exams -> student_textbooks (2段)
--   - student_progress_lessons: student_progress_id -> student_progress -> student_textbooks (2段)
--   - seasonal_course_curriculum/textbooks: course_id -> seasonal_courses.school_id
--   - transfer_notifications: school_id 直持ち
--
-- ※ form_fields / form_template_fields / シフトslot子 / user_schools は
--   公開ポータル・公開シフトフォーム(匿名)の参照可能性があるため別途調査して対応。
-- ============================================================

BEGIN;

-- ── student_textbooks の子(1段) ──
DROP POLICY IF EXISTS "student_progress_allow_all_auth" ON public.student_progress;
CREATE POLICY "student_progress_school_scope_auth" ON public.student_progress FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.student_textbooks st WHERE st.id=student_progress.student_textbook_id AND public.check_school_access(st.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.student_textbooks st WHERE st.id=student_progress.student_textbook_id AND public.check_school_access(st.school_id)));

DROP POLICY IF EXISTS "student_textbook_exams_allow_all_auth" ON public.student_textbook_exams;
CREATE POLICY "student_textbook_exams_school_scope_auth" ON public.student_textbook_exams FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.student_textbooks st WHERE st.id=student_textbook_exams.student_textbook_id AND public.check_school_access(st.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.student_textbooks st WHERE st.id=student_textbook_exams.student_textbook_id AND public.check_school_access(st.school_id)));

DROP POLICY IF EXISTS "student_textbook_exam_ranges_allow_all_auth" ON public.student_textbook_exam_ranges;
CREATE POLICY "student_textbook_exam_ranges_school_scope_auth" ON public.student_textbook_exam_ranges FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.student_textbooks st WHERE st.id=student_textbook_exam_ranges.student_textbook_id AND public.check_school_access(st.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.student_textbooks st WHERE st.id=student_textbook_exam_ranges.student_textbook_id AND public.check_school_access(st.school_id)));

DROP POLICY IF EXISTS "student_textbook_settings_allow_all_auth" ON public.student_textbook_settings;
CREATE POLICY "student_textbook_settings_school_scope_auth" ON public.student_textbook_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.student_textbooks st WHERE st.id=student_textbook_settings.student_textbook_id AND public.check_school_access(st.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.student_textbooks st WHERE st.id=student_textbook_settings.student_textbook_id AND public.check_school_access(st.school_id)));

-- ── 2段結合 ──
DROP POLICY IF EXISTS "action_goals_allow_all_auth" ON public.action_goals;
CREATE POLICY "action_goals_school_scope_auth" ON public.action_goals FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.student_textbook_exams e JOIN public.student_textbooks st ON st.id=e.student_textbook_id WHERE e.id=action_goals.student_textbook_exam_id AND public.check_school_access(st.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.student_textbook_exams e JOIN public.student_textbooks st ON st.id=e.student_textbook_id WHERE e.id=action_goals.student_textbook_exam_id AND public.check_school_access(st.school_id)));

DROP POLICY IF EXISTS "student_progress_lessons_allow_all_auth" ON public.student_progress_lessons;
CREATE POLICY "student_progress_lessons_school_scope_auth" ON public.student_progress_lessons FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.student_progress sp JOIN public.student_textbooks st ON st.id=sp.student_textbook_id WHERE sp.id=student_progress_lessons.student_progress_id AND public.check_school_access(st.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.student_progress sp JOIN public.student_textbooks st ON st.id=sp.student_textbook_id WHERE sp.id=student_progress_lessons.student_progress_id AND public.check_school_access(st.school_id)));

-- ── seasonal_courses の子(1段) ──
DROP POLICY IF EXISTS "seasonal_course_curriculum_authenticated_all" ON public.seasonal_course_curriculum;
CREATE POLICY "seasonal_course_curriculum_school_scope_auth" ON public.seasonal_course_curriculum FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.seasonal_courses c WHERE c.id=seasonal_course_curriculum.course_id AND public.check_school_access(c.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.seasonal_courses c WHERE c.id=seasonal_course_curriculum.course_id AND public.check_school_access(c.school_id)));

DROP POLICY IF EXISTS "seasonal_course_textbooks_authenticated_all" ON public.seasonal_course_textbooks;
CREATE POLICY "seasonal_course_textbooks_school_scope_auth" ON public.seasonal_course_textbooks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.seasonal_courses c WHERE c.id=seasonal_course_textbooks.course_id AND public.check_school_access(c.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.seasonal_courses c WHERE c.id=seasonal_course_textbooks.course_id AND public.check_school_access(c.school_id)));

-- ── 直 school_id ──
DROP POLICY IF EXISTS "transfer_notifications_allow_all_auth" ON public.transfer_notifications;
CREATE POLICY "transfer_notifications_school_scope_auth" ON public.transfer_notifications FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

COMMIT;
