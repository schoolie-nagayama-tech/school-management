-- ============================================================
-- 講師リリース準備①: class_reports / lesson_report_units を教室スコープRLSに
--
-- 背景:
--   授業報告(PII含む)が *_allow_all_auth (USING true) のままで、認証済みユーザー
--   (講師含む)が他教室・他講師の授業報告を読み書きできた。
--   親(class_reports)は school_id 直持ち、子(lesson_report_units)は report_id 経由で絞る。
--   ※現時点で本番データは 0 件だが、講師リリース前に塞いでおく。
--
--   NOTE: 「自分の授業報告のみ編集可」「承認済みは編集不可」といった
--   teacher_id/status ベースの制限は別途アプリ側＋追加RLSで対応予定。
--   本マイグレーションは教室スコープ化のみ。
-- ============================================================

BEGIN;

-- 親: class_reports
DROP POLICY IF EXISTS "class_reports_allow_all_auth" ON public.class_reports;
CREATE POLICY "class_reports_school_scope_auth"
  ON public.class_reports FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- 子: lesson_report_units (report_id -> class_reports.school_id)
DROP POLICY IF EXISTS "lesson_report_units_allow_all_auth" ON public.lesson_report_units;
CREATE POLICY "lesson_report_units_school_scope_auth"
  ON public.lesson_report_units FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.class_reports cr
    WHERE cr.id = lesson_report_units.report_id
      AND public.check_school_access(cr.school_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.class_reports cr
    WHERE cr.id = lesson_report_units.report_id
      AND public.check_school_access(cr.school_id)
  ));

COMMIT;
