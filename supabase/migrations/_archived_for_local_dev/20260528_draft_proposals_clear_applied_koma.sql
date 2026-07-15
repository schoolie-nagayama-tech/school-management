-- 下書き(draft)状態の提案書は「申込」未確定とする。
-- テンプレ適用時に applied_koma を提案回数で埋めていた名残を 0 にリセットする。
-- 申込は提案済/公開にしたタイミングで koma_count から初期化される。
UPDATE seasonal_proposal_units u
SET applied_koma = 0
FROM seasonal_proposals p
WHERE p.id = u.proposal_id
  AND p.status = 'draft'
  AND u.applied_koma > 0;

UPDATE seasonal_proposals
SET applied_koma = 0
WHERE status = 'draft'
  AND applied_koma > 0;
