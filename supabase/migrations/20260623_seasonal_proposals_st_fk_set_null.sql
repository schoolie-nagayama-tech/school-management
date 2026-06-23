-- 提案書(seasonal_proposals)が student_textbooks の削除で道連れに消えるのを防ぐ。
--
-- 背景: これまで seasonal_proposals.student_textbook_id の FK は ON DELETE CASCADE だったため、
-- 生徒詳細で「所持教材」を1件削除しただけで、その教材に紐付く講習提案書ごと消えていた。
-- 提案書は所持教材より重要な記録（作成・公開のワークフローの核）なので、教材を消しても
-- 提案書は残すべき。リンクだけ外す ON DELETE SET NULL に変更する。
-- student_textbook_id は NULL 許容なので SET NULL で問題ない（公開し直す際に再リンクされる）。
ALTER TABLE public.seasonal_proposals
  DROP CONSTRAINT IF EXISTS seasonal_proposals_student_textbook_id_fkey;

ALTER TABLE public.seasonal_proposals
  ADD CONSTRAINT seasonal_proposals_student_textbook_id_fkey
  FOREIGN KEY (student_textbook_id)
  REFERENCES public.student_textbooks(id)
  ON DELETE SET NULL;
