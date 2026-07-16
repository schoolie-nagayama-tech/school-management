-- ============================================================
-- 修正: attendance_types を教室スコープに（①-10 の補正）
--
-- ①-10(tail_d) で attendance_types を public→authenticated にしたが USING(true) のままで、
-- attendance_types は school_id を持つ（全件 per-school）ため越境が残っていた。
-- check_school_access(school_id) でスコープ化する（将来の全教室共通行のため NULL も許可）。
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "attendance_types_authenticated_all" ON public.attendance_types;
CREATE POLICY "attendance_types_school_scope_auth" ON public.attendance_types FOR ALL TO authenticated
  USING (school_id IS NULL OR public.check_school_access(school_id))
  WITH CHECK (school_id IS NULL OR public.check_school_access(school_id));

COMMIT;
