-- ============================================================
-- 講師リリース準備①: test_prep_proposals 系を教室スコープRLSに
--
-- 背景:
--   テスト対策提案の3テーブルが *_authenticated_all (USING true) のままで、
--   認証済みユーザー(講師含む)が他教室・他講師の提案を読み書きできた。
--   - test_prep_proposals         : school_id 直持ち
--   - test_prep_proposal_subjects : proposal_id -> proposals.school_id
--   - test_prep_proposal_units    : subject_id -> subjects -> proposals.school_id (2段)
--   ※現時点で本番データは 0 件だが、講師リリース前に塞いでおく。
-- ============================================================

BEGIN;

-- 親: test_prep_proposals
DROP POLICY IF EXISTS "test_prep_proposals_authenticated_all" ON public.test_prep_proposals;
CREATE POLICY "test_prep_proposals_school_scope_auth"
  ON public.test_prep_proposals FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- 子: test_prep_proposal_subjects (proposal_id -> proposals.school_id)
DROP POLICY IF EXISTS "test_prep_proposal_subjects_authenticated_all" ON public.test_prep_proposal_subjects;
CREATE POLICY "test_prep_proposal_subjects_school_scope_auth"
  ON public.test_prep_proposal_subjects FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.test_prep_proposals p
    WHERE p.id = test_prep_proposal_subjects.proposal_id
      AND public.check_school_access(p.school_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.test_prep_proposals p
    WHERE p.id = test_prep_proposal_subjects.proposal_id
      AND public.check_school_access(p.school_id)
  ));

-- 孫: test_prep_proposal_units (subject_id -> subjects -> proposals.school_id)
DROP POLICY IF EXISTS "test_prep_proposal_units_authenticated_all" ON public.test_prep_proposal_units;
CREATE POLICY "test_prep_proposal_units_school_scope_auth"
  ON public.test_prep_proposal_units FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.test_prep_proposal_subjects s
    JOIN public.test_prep_proposals p ON p.id = s.proposal_id
    WHERE s.id = test_prep_proposal_units.subject_id
      AND public.check_school_access(p.school_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.test_prep_proposal_subjects s
    JOIN public.test_prep_proposals p ON p.id = s.proposal_id
    WHERE s.id = test_prep_proposal_units.subject_id
      AND public.check_school_access(p.school_id)
  ));

COMMIT;
