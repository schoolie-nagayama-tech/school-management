-- ============================================================
-- 講師リリース準備①(テールB): 講師個人データを「本人＋教室長」RLSに
--
-- teacher_absences / teacher_availability_periods (school_id + user_id):
--   RESTRICTIVE 教室スコープ + PERMISSIVE manager全件 + PERMISSIVE 本人(user_id)
--   ※本人は自分の行をフル操作可（attendance と同型）
-- teacher_badge_assignments / teacher_trainings (teacher_id, school_id無し):
--   PERMISSIVE manager全件(ALL) + PERMISSIVE 本人(SELECT のみ)
--   ※付与・編集は教室長以上のみ（canEditTeacherBadges=false に整合）、講師は自分の分を閲覧のみ
-- bulletin_reads (user_id): 本人のみ（個人の既読状態）
-- ============================================================

BEGIN;

-- ── teacher_absences ──
DROP POLICY IF EXISTS "teacher_absences_all" ON public.teacher_absences;
CREATE POLICY "teacher_absences_school_restrict" ON public.teacher_absences AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.check_school_access(school_id)) WITH CHECK (public.check_school_access(school_id));
CREATE POLICY "teacher_absences_manager_all" ON public.teacher_absences AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id=auth.uid() AND up.role IN ('admin','owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id=auth.uid() AND up.role IN ('admin','owner','manager')));
CREATE POLICY "teacher_absences_own" ON public.teacher_absences AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── teacher_availability_periods ──
DROP POLICY IF EXISTS "teacher_availability_periods_all" ON public.teacher_availability_periods;
CREATE POLICY "teacher_availability_periods_school_restrict" ON public.teacher_availability_periods AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.check_school_access(school_id)) WITH CHECK (public.check_school_access(school_id));
CREATE POLICY "teacher_availability_periods_manager_all" ON public.teacher_availability_periods AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id=auth.uid() AND up.role IN ('admin','owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id=auth.uid() AND up.role IN ('admin','owner','manager')));
CREATE POLICY "teacher_availability_periods_own" ON public.teacher_availability_periods AS PERMISSIVE FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── teacher_badge_assignments (付与は教室長のみ・講師は本人分の閲覧のみ) ──
DROP POLICY IF EXISTS "teacher_badge_assignments_insert" ON public.teacher_badge_assignments;
DROP POLICY IF EXISTS "teacher_badge_assignments_select" ON public.teacher_badge_assignments;
CREATE POLICY "teacher_badge_assignments_manager_all" ON public.teacher_badge_assignments AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id=auth.uid() AND up.role IN ('admin','owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id=auth.uid() AND up.role IN ('admin','owner','manager')));
CREATE POLICY "teacher_badge_assignments_own_read" ON public.teacher_badge_assignments AS PERMISSIVE FOR SELECT TO authenticated
  USING (teacher_id = auth.uid());

-- ── teacher_trainings (同上) ──
DROP POLICY IF EXISTS "teacher_trainings_insert" ON public.teacher_trainings;
DROP POLICY IF EXISTS "teacher_trainings_select" ON public.teacher_trainings;
CREATE POLICY "teacher_trainings_manager_all" ON public.teacher_trainings AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id=auth.uid() AND up.role IN ('admin','owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id=auth.uid() AND up.role IN ('admin','owner','manager')));
CREATE POLICY "teacher_trainings_own_read" ON public.teacher_trainings AS PERMISSIVE FOR SELECT TO authenticated
  USING (teacher_id = auth.uid());

-- ── bulletin_reads (本人のみ) ──
DROP POLICY IF EXISTS "bulletin_reads_allow_all_auth" ON public.bulletin_reads;
CREATE POLICY "bulletin_reads_own" ON public.bulletin_reads FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

COMMIT;
