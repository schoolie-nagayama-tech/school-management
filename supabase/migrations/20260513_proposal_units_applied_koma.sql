-- 提案単元ごとの申込コマ数
ALTER TABLE seasonal_proposal_units
  ADD COLUMN IF NOT EXISTS applied_koma INT;
