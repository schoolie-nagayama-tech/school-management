-- ============================================================
-- 掲示板の既読数(既読者一覧)が教室長から常に0人に見える不具合を修正
--
-- 背景:
--   20260615_rls_teacher_scope_tail_b_teacher_personal.sql で bulletin_reads を
--   「本人のみ」(bulletin_reads_own) にスコープ化した際、同じマイグレーション内の
--   兄弟テーブル(teacher_absences/teacher_availability_periods/
--   teacher_badge_assignments/teacher_trainings)には必ず追加していた
--   「教室長以上は全件閲覧可」の PERMISSIVE ポリシーだけ bulletin_reads に
--   漏れていた。アプリの「既読: N人」表示・既読者一覧モーダルは講師以外の
--   既読レコードを読む必要があるため、これが原因で常に0人に見えていた。
--   （講師が「見ました」を押す INSERT 自体は本人の行なので成功しており、
--   　教室長が見るときの SELECT だけが空になっていた）
--
--   本人のプライバシー（他の講師からは見えない）は維持しつつ、
--   教室長以上には兄弟テーブルと同じパターンで全件閲覧を許可する。
-- ============================================================

BEGIN;

CREATE POLICY "bulletin_reads_manager_all"
  ON public.bulletin_reads AS PERMISSIVE FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('admin', 'owner', 'manager')
    )
  );

COMMIT;
