-- ============================================================
-- 成績(assessments)行の削除を教室長以上に制限する
--
-- 背景:
--   生徒の成績画面で「削除」ボタンをUI側では講師に非表示にしたが、
--   RLSポリシー assessments_school_scope_auth は FOR ALL かつ
--   check_school_access(school_id) のみ（ロール不問）だったため、
--   同一教室の講師であればAPIを直接叩けば依然として削除できてしまう状態だった。
--   teacher_badges_delete 等と同じ「check_school_access AND check_user_role」の
--   パターンで、DELETE だけ教室長以上(admin/owner/manager)に限定する。
--   SELECT/INSERT/UPDATE は従来どおり school_id スコープのみ（講師の
--   入力・編集は引き続き可能）。
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "assessments_school_scope_auth" ON public.assessments;

CREATE POLICY "assessments_school_scope_select"
  ON public.assessments FOR SELECT TO authenticated
  USING (public.check_school_access(school_id));

CREATE POLICY "assessments_school_scope_insert"
  ON public.assessments FOR INSERT TO authenticated
  WITH CHECK (public.check_school_access(school_id));

CREATE POLICY "assessments_school_scope_update"
  ON public.assessments FOR UPDATE TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

CREATE POLICY "assessments_delete_manager_plus"
  ON public.assessments FOR DELETE TO authenticated
  USING (
    public.check_school_access(school_id)
    AND public.check_user_role(ARRAY['admin', 'owner', 'manager'])
  );

COMMIT;
