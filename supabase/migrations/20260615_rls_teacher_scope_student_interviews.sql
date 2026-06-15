-- ============================================================
-- 講師リリース準備①: student_interviews を教室スコープRLSに
--
-- 背景:
--   student_interviews は "student_interviews_authenticated_all"
--   (USING true / WITH CHECK true) のままで、認証済みユーザー(講師含む)が
--   他教室の面談記録(PII)を読み書きできる状態だった。
--   20260520_rls_school_scope_phase2.sql と同じ check_school_access(school_id)
--   パターンに統一し、teacher は user_schools に紐づく教室のみに制限する。
--
-- ロール別:
--   admin/owner/manager → check_school_access が常に TRUE → 全教室
--   teacher            → user_schools の紐づき教室のみ
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "student_interviews_authenticated_all" ON public.student_interviews;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.student_interviews;

CREATE POLICY "student_interviews_school_scope_auth"
  ON public.student_interviews FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

COMMIT;
