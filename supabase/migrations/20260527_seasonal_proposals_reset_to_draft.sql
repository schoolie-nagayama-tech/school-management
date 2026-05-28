-- 講習提案書の取り扱いを「テンプレ適用＝下書き、生徒ごとにカスタマイズして公開」に変更
-- 既存の sent/approved 提案書はすべて draft に戻す（適用済み履歴 seasonal_course_applications は保持）
-- 公開時の進行表反映ロジックは別途 publishProposal 側で track_progress を有効化する形に修正済み
UPDATE seasonal_proposals
SET status = 'draft', updated_at = now()
WHERE status IN ('sent', 'approved');
