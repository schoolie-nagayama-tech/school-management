-- ============================================================
-- 講師リリース準備①: assessment_scores を教室スコープRLSに
--
-- 背景:
--   assessment_scores は "Allow all for authenticated users" /
--   "assessment_scores_allow_all_auth" (USING true) が二重に残り、認証済みユーザー
--   (講師含む)が他教室の成績点数を読み書きできた。
--   assessment_scores は school_id を持たないため、親 assessments(school_id) を
--   assessment_id 経由で参照して check_school_access で絞る。
--   (assessments 自体は 20260520_rls_school_scope_phase2.sql で対応済み)
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "assessment_scores_allow_all_auth" ON public.assessment_scores;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.assessment_scores;

CREATE POLICY "assessment_scores_school_scope_auth"
  ON public.assessment_scores FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = assessment_scores.assessment_id
      AND public.check_school_access(a.school_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.assessments a
    WHERE a.id = assessment_scores.assessment_id
      AND public.check_school_access(a.school_id)
  ));

COMMIT;
