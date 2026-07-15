-- テキスト（textbooks）に「対応する発注教材(materials)」を任意で紐付ける。
-- 提案書公開時の自動発注（ハイブリッド）で使用: 紐付けがあれば発注内容を自動生成、無ければ手動発注へ誘導。
-- 1テキスト=1発注教材の想定。デジタル教材など発注不要なテキストは NULL のまま。
ALTER TABLE textbooks
  ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES materials(id) ON DELETE SET NULL;
