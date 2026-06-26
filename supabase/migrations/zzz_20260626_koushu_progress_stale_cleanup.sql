-- ============================================================
-- 講習提案書: 進行表への申込/提案コマ「取り残し」是正（2026-06-26 本番適用済み）
-- ============================================================
-- 背景:
--   公開(approved)時の転記 syncProposalToProgress / syncApplicationToProgress は
--   「その時点の提案単元」しか student_progress を書き換えない。公開後に単元を削除/差し替え
--   したり下書きに戻すと、削除済み単元の application_count / proposal_count / 結合番号が
--   student_progress に残り、進行表の申込・提案コマが実際の提案より過大表示になっていた。
--
-- 是正内容:
--   講習提案書に紐づく student_textbook について、現在のいずれの提案単元にも含まれない行の
--   application_count / proposal_count を 0、applied_group_number / group_number を NULL にする。
--   is_owned 等の所持フラグや進捗ステータスには一切触れない。
--
-- 実績: 本番(school-db-tokyo)で 1439 行を是正（実行後 残存齟齬 0 を確認）。
-- 再発防止: コード側(publishProposal の転記)に同等のクリアを追加済み（公開＝完全上書き）。
-- 冪等: 再実行しても対象が無ければ 0 行更新。
-- ============================================================

UPDATE student_progress sp
SET application_count = 0,
    proposal_count = 0,
    applied_group_number = NULL,
    group_number = NULL
WHERE sp.student_textbook_id IN (
        SELECT DISTINCT student_textbook_id
        FROM seasonal_proposals
        WHERE student_textbook_id IS NOT NULL
      )
  AND (
        COALESCE(sp.application_count, 0) > 0
        OR COALESCE(sp.proposal_count, 0) > 0
        OR sp.applied_group_number IS NOT NULL
        OR sp.group_number IS NOT NULL
      )
  AND NOT EXISTS (
        SELECT 1
        FROM seasonal_proposals p
        JOIN seasonal_proposal_units u ON u.proposal_id = p.id
        WHERE p.student_textbook_id = sp.student_textbook_id
          AND u.curriculum_item_id = sp.curriculum_item_id
      );
