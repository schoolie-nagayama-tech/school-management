-- ============================================================
-- RLS 緊急修正 その2: 講習・テスト対策の提案系テーブルから
--                     anon / public フルアクセスを剥奪する
-- ============================================================
--
-- 背景:
--   seasonal_* / test_prep_* の各テーブルが {public} FOR ALL USING(true) で開放され、
--   anon キーだけで講習提案・テスト対策提案（生徒氏名を含む）を
--   read / insert / update / delete できる状態だった。
--
-- 安全性の確認（破壊しないこと）:
--   - これらを読む lib/api 関数の呼び出し元は /courses・/schedule・/test-prep（editor）
--     等のスタッフ専用ページのみ（middleware の公開ルート外＝authenticated）。
--   - 公開のテスト対策閲覧ページ /test-prep/[token] は service-role API
--     (/api/test-prep/public) 経由で取得しており anon 直読していない。
--   - 公開ポータル（portal/shift/attendance/invite）はこれらを参照しない。
--   よって anon を排除しても公開機能は壊れない。
--
-- 各テーブルの唯一のポリシーが {public} のため、authenticated 版に置換する
-- （DROP のみだとスタッフもアクセス不能になるため）。
-- 教室スコープ化（authenticated 内での横断防止）は後続のハードニングで対応する。
-- ============================================================

DROP POLICY IF EXISTS "Enable all for seasonal_courses" ON public.seasonal_courses;
CREATE POLICY "seasonal_courses_authenticated_all" ON public.seasonal_courses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all for seasonal_course_curriculum" ON public.seasonal_course_curriculum;
CREATE POLICY "seasonal_course_curriculum_authenticated_all" ON public.seasonal_course_curriculum
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all for seasonal_course_textbooks" ON public.seasonal_course_textbooks;
CREATE POLICY "seasonal_course_textbooks_authenticated_all" ON public.seasonal_course_textbooks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all for seasonal_course_applications" ON public.seasonal_course_applications;
CREATE POLICY "seasonal_course_applications_authenticated_all" ON public.seasonal_course_applications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "seasonal_proposals_all" ON public.seasonal_proposals;
CREATE POLICY "seasonal_proposals_authenticated_all" ON public.seasonal_proposals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "seasonal_proposal_units_all" ON public.seasonal_proposal_units;
CREATE POLICY "seasonal_proposal_units_authenticated_all" ON public.seasonal_proposal_units
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "test_prep_proposals_all" ON public.test_prep_proposals;
CREATE POLICY "test_prep_proposals_authenticated_all" ON public.test_prep_proposals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "test_prep_proposal_units_all" ON public.test_prep_proposal_units;
CREATE POLICY "test_prep_proposal_units_authenticated_all" ON public.test_prep_proposal_units
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "test_prep_proposal_subjects_all" ON public.test_prep_proposal_subjects;
CREATE POLICY "test_prep_proposal_subjects_authenticated_all" ON public.test_prep_proposal_subjects
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
