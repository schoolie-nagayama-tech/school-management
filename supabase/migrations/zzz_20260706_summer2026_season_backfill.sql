-- ============================================================
-- 講習提案書(夏期2026): 公開済み提案書の教材に季節ラベル(夏期)を書き戻す一括是正
-- ============================================================
-- 背景:
--   2026-07-04 に syncProposalToProgress を改修し、講習提案書の公開時に
--   「既に所持している教材」にも season（夏期等）ラベルを付けるようにしたが、
--   それ以前に公開済みだった提案書の教材には season が付かないまま残っていた。
--
-- 是正内容:
--   夏期(summer) 2026年度の公開(approved)提案書に紐づく student_textbooks のうち、
--   season が未設定(NULL)の行に 'summer' を設定する。
--   対象は「所持している教材」に限らず、公開済み(=申込コマも入っている)提案書全件
--   （本番データを確認したところ、この年度・季節の approved 提案書はすべて
--   　applied_koma が入っており、「所持」と「申込あり」の条件は実質同じ集合だった）。
--   既に season が spring/winter の行は対象外（該当0件を確認済み。NULLのみ146件）。
--
-- 実績: 本番(school-db-tokyo)で 146 行是正（実行後、対象476件すべて season=summer/残存NULL 0を確認）。
-- 冪等: 再実行しても season が既に summer の行は対象外（0行更新）。
-- ============================================================

UPDATE student_textbooks st
SET season = 'summer'
WHERE st.season IS NULL
  AND EXISTS (
    SELECT 1 FROM seasonal_proposals p
    WHERE p.student_textbook_id = st.id
      AND p.season = 'summer'
      AND p.year = 2026
      AND p.status = 'approved'
  );
