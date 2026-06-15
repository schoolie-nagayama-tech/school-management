-- ============================================================
-- 講師リリース準備①: attendance_* を教室スコープ + 本人限定RLSに
--
-- 背景:
--   attendance_sheets/records/notes は "Allow all for ..." が role=public
--   (匿名含む) かつ USING(true) のままで、未認証でも直API経由で全教室の
--   出勤簿(給与関連のプライベート情報)を読み書きできた。
--
-- 方針 (seasonal_shift_submissions と同じ RESTRICTIVE + PERMISSIVE 構成):
--   最終結果 = (PERMISSIVE の OR) AND (RESTRICTIVE の AND)
--   - RESTRICTIVE: 教室スコープ (check_school_access)
--   - PERMISSIVE manager_all: admin/owner/manager は対象範囲の全件
--   - PERMISSIVE teacher_own: teacher は自分の出勤簿(teacher_id=auth.uid())のみ
--   role は public → authenticated に変更し匿名アクセスを遮断。
--   子(records/notes)は sheet_id 経由で親 attendance_sheets を参照。
--
--   ※あわせて middleware.ts の /attendance を公開ルートから除去
--     (画面はもともとログイン必須。整合のため)。
-- ============================================================

BEGIN;

-- ── attendance_sheets ──
DROP POLICY IF EXISTS "Allow all for attendance_sheets" ON public.attendance_sheets;

CREATE POLICY "attendance_sheets_school_restrict" ON public.attendance_sheets
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

CREATE POLICY "attendance_sheets_manager_all" ON public.attendance_sheets
  AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager')));

CREATE POLICY "attendance_sheets_teacher_own" ON public.attendance_sheets
  AS PERMISSIVE FOR ALL TO authenticated
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

-- ── attendance_records (sheet_id -> attendance_sheets) ──
DROP POLICY IF EXISTS "Allow all for attendance_records" ON public.attendance_records;

CREATE POLICY "attendance_records_school_restrict" ON public.attendance_records
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.attendance_sheets s WHERE s.id = attendance_records.sheet_id AND public.check_school_access(s.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.attendance_sheets s WHERE s.id = attendance_records.sheet_id AND public.check_school_access(s.school_id)));

CREATE POLICY "attendance_records_manager_all" ON public.attendance_records
  AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager')));

CREATE POLICY "attendance_records_teacher_own" ON public.attendance_records
  AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.attendance_sheets s WHERE s.id = attendance_records.sheet_id AND s.teacher_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.attendance_sheets s WHERE s.id = attendance_records.sheet_id AND s.teacher_id = auth.uid()));

-- ── attendance_notes (sheet_id -> attendance_sheets) ──
DROP POLICY IF EXISTS "Allow all for attendance_notes" ON public.attendance_notes;

CREATE POLICY "attendance_notes_school_restrict" ON public.attendance_notes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.attendance_sheets s WHERE s.id = attendance_notes.sheet_id AND public.check_school_access(s.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.attendance_sheets s WHERE s.id = attendance_notes.sheet_id AND public.check_school_access(s.school_id)));

CREATE POLICY "attendance_notes_manager_all" ON public.attendance_notes
  AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager')));

CREATE POLICY "attendance_notes_teacher_own" ON public.attendance_notes
  AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.attendance_sheets s WHERE s.id = attendance_notes.sheet_id AND s.teacher_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.attendance_sheets s WHERE s.id = attendance_notes.sheet_id AND s.teacher_id = auth.uid()));

COMMIT;
