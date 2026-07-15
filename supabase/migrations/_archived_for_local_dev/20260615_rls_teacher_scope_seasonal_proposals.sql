-- ============================================================
-- 講師リリース準備①: seasonal_proposals / seasonal_proposal_units を教室スコープRLSに
--
-- 背景:
--   両テーブルとも *_authenticated_all (USING true) のままで、認証済みユーザー
--   (講師含む)が他教室の講習提案を読み書きできた。
--   親(seasonal_proposals)は school_id を直接持つので check_school_access(school_id)、
--   子(seasonal_proposal_units)は proposal_id 経由で親の school_id を参照して絞る。
-- ============================================================

BEGIN;

-- 親: seasonal_proposals
DROP POLICY IF EXISTS "seasonal_proposals_authenticated_all" ON public.seasonal_proposals;
CREATE POLICY "seasonal_proposals_school_scope_auth"
  ON public.seasonal_proposals FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- 子: seasonal_proposal_units (proposal_id -> seasonal_proposals.school_id)
DROP POLICY IF EXISTS "seasonal_proposal_units_authenticated_all" ON public.seasonal_proposal_units;
CREATE POLICY "seasonal_proposal_units_school_scope_auth"
  ON public.seasonal_proposal_units FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.seasonal_proposals p
    WHERE p.id = seasonal_proposal_units.proposal_id
      AND public.check_school_access(p.school_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.seasonal_proposals p
    WHERE p.id = seasonal_proposal_units.proposal_id
      AND public.check_school_access(p.school_id)
  ));

COMMIT;
