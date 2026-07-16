-- 提案単元に指導意図タグを追加
ALTER TABLE seasonal_proposal_units
  ADD COLUMN IF NOT EXISTS intent_tag TEXT;
