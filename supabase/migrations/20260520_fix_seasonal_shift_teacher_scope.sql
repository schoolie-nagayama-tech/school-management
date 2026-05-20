-- ============================================================
-- Fix: seasonal_shift_submissions の教師制限リグレッション修正
--
-- Phase 2 migration で seasonal_shift_submissions_manager_all と
-- seasonal_shift_submissions_teacher_own を単一の school_scope ポリシーに
-- 統合してしまい、教師が他教師の提出も閲覧できるようになった。
--
-- 修正:
--   RESTRICTIVE ポリシーで school_id スコープを強制（AND 条件）
--   PERMISSIVE ポリシーで manager 全件 / teacher 自分のみ を復元
-- ============================================================

BEGIN;

-- 1. Phase 2 で作成した単一ポリシーを削除
DROP POLICY IF EXISTS "seasonal_shift_submissions_school_scope_auth"
  ON public.seasonal_shift_submissions;

-- 2. RESTRICTIVE ポリシー: school_id スコープ（全ロール共通の AND 条件）
CREATE POLICY "seasonal_shift_submissions_school_restrict"
  ON public.seasonal_shift_submissions
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- 3. PERMISSIVE ポリシー: admin/owner/manager は全件アクセス
CREATE POLICY "seasonal_shift_submissions_manager_all"
  ON public.seasonal_shift_submissions
  AS PERMISSIVE
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.role IN ('admin', 'owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid()
      AND up.role IN ('admin', 'owner', 'manager')
    )
  );

-- 4. PERMISSIVE ポリシー: teacher は自分の提出のみ
CREATE POLICY "seasonal_shift_submissions_teacher_own"
  ON public.seasonal_shift_submissions
  AS PERMISSIVE
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMIT;
