-- schedule_daily_booth_assignments の RLS ポリシー欠落を是正
--
-- 症状: 日付ヘッダーの座席番号（ブース番号）一括登録がエラーになる。
-- 原因: このテーブルは RLS 有効（relrowsecurity=true）だが、ポリシーが1つも無かった。
--   RLS 有効かつポリシー0件 = authenticated からの SELECT/INSERT/DELETE が全拒否になり、
--   setDailyBoothAssignments の DELETE→INSERT が失敗していた。
--   （東京DB移行時にポリシーが取り残されたと思われる。）
--
-- 対処: 他のスケジュール系テーブルと同じ check_school_access(school_id) 方針で
--   authenticated の全操作を教室スコープで許可する。anon は遮断される。
--
-- ロールバック:
--   DROP POLICY IF EXISTS schedule_daily_booth_assignments_school_scope_auth
--     ON public.schedule_daily_booth_assignments;

DROP POLICY IF EXISTS "schedule_daily_booth_assignments_school_scope_auth"
  ON public.schedule_daily_booth_assignments;
CREATE POLICY "schedule_daily_booth_assignments_school_scope_auth"
  ON public.schedule_daily_booth_assignments FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));
