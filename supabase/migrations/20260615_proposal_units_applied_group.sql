-- 申込専用の単元グルーピング（提案グループ group_id とは独立）
-- 提案では別々のコマでも、申込時に「2単元で1コマ」のようにまとめたいケースに対応する。
-- group_id（提案結合）と applied_group_id（申込結合）を分けて持つことで、
-- 「提案0コマ・申込1コマ（提案していないコマを取った）」のような構成も表現できる。
ALTER TABLE seasonal_proposal_units
  ADD COLUMN IF NOT EXISTS applied_group_id INT NOT NULL DEFAULT 0;

-- 既存データのバックフィル: これまで申込コマの合計は提案結合(group_id)で1コマにまとめていた。
-- 申込合計の dedup を applied_group_id 基準に変えるため、未設定(0)の行は提案結合に合わせておく
-- （そうしないと既存の提案済み提案書で申込コマが二重計上される）。
UPDATE seasonal_proposal_units
  SET applied_group_id = group_id
  WHERE applied_group_id = 0 AND group_id > 0;
