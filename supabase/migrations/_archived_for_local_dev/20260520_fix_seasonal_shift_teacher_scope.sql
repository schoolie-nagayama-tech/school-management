-- ============================================================
-- Fix: seasonal_shift_submissions の教師制限リグレッション修正
--
-- 問題:
--   Phase 2 migration (20260520_rls_school_scope_phase2.sql) で
--   seasonal_shift_submissions_manager_all / _teacher_own を単一の
--   school_scope ポリシーに統合してしまった。
--   結果: 教師が同教室の他教師のシフト提出も閲覧可能になるリグレッション。
--
-- 修正方針:
--   PostgreSQL の RLS 評価ルールを活用:
--     最終結果 = (PERMISSIVE_1 OR PERMISSIVE_2 OR ...) AND (RESTRICTIVE_1 AND ...)
--
--   RESTRICTIVE で school_id スコープを強制しつつ、
--   PERMISSIVE でロール別アクセス範囲を制御する。
--
-- ロール別アクセス結果:
--   admin/owner/manager → (manager_all=TRUE) AND (school=TRUE) → 所属教室の全提出
--   teacher             → (teacher_own=自分のみ) AND (school=TRUE) → 所属教室の自分の提出のみ
--   parent等            → (manager_all=FALSE OR teacher_own=FALSE) → アクセス不可
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
