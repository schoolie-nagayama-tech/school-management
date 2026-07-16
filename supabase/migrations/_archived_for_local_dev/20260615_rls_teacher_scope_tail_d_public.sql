-- ============================================================
-- 講師リリース準備①(テールD): public ロールの残ポリシーを是正
--
-- 調査結果:
--   - course_prep_* / google_calendar_tokens は role=public だが述語が
--     check_school_access / auth.uid()=user_id のため匿名は弾かれる → 是正不要。
--   - monthly_task_checks: 述語が auth.uid() IS NOT NULL のみで、任意の認証ユーザーが
--     全教室の月次タスク達成状況を読み書き可能だった。school_id でスコープ化する。
--   - attendance_types: USING(true) かつ role=public で匿名でも read/write 可能だった。
--     school_id を持たない共通マスタなので、他マスタ同様 authenticated に限定する。
--
--   ※ user_schools の "Anyone can view ..."(匿名全件SELECT) は別途検討
--     (アプリの講師一覧フロー影響確認のため本マイグレーションには含めない)。
-- ============================================================

BEGIN;

-- monthly_task_checks: 教室スコープ化
DROP POLICY IF EXISTS "monthly_task_checks_insert" ON public.monthly_task_checks;
DROP POLICY IF EXISTS "monthly_task_checks_select" ON public.monthly_task_checks;
DROP POLICY IF EXISTS "monthly_task_checks_update" ON public.monthly_task_checks;
DROP POLICY IF EXISTS "monthly_task_checks_delete" ON public.monthly_task_checks;
CREATE POLICY "monthly_task_checks_school_scope_auth" ON public.monthly_task_checks FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- attendance_types: 匿名遮断（共通マスタなので authenticated は従来どおり read/write 可）
DROP POLICY IF EXISTS "Allow all for attendance_types" ON public.attendance_types;
CREATE POLICY "attendance_types_authenticated_all" ON public.attendance_types FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMIT;
