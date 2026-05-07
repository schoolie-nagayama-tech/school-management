-- 保護者向け講習提案書
-- 生徒×テキスト単位で、講習テーマ・対象単元・単元別理由を管理

-- 提案書メタデータ
CREATE TABLE IF NOT EXISTS seasonal_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_textbook_id UUID NOT NULL REFERENCES student_textbooks(id) ON DELETE CASCADE,
  season TEXT NOT NULL CHECK (season IN ('spring', 'summer', 'winter')),
  year INT NOT NULL DEFAULT EXTRACT(YEAR FROM now()),
  theme TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'approved')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 同じ生徒テキスト × 季節 × 年は1件
  UNIQUE (student_textbook_id, season, year)
);

-- 提案単元明細
CREATE TABLE IF NOT EXISTS seasonal_proposal_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES seasonal_proposals(id) ON DELETE CASCADE,
  curriculum_item_id INT NOT NULL REFERENCES curriculum_items(id) ON DELETE CASCADE,
  koma_count INT NOT NULL DEFAULT 1,
  reason TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, curriculum_item_id)
);

-- RLS
ALTER TABLE seasonal_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasonal_proposal_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seasonal_proposals_all" ON seasonal_proposals
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "seasonal_proposal_units_all" ON seasonal_proposal_units
  FOR ALL USING (true) WITH CHECK (true);

-- updated_at trigger
CREATE TRIGGER set_updated_at_seasonal_proposals
  BEFORE UPDATE ON seasonal_proposals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- indexes
CREATE INDEX idx_seasonal_proposals_st ON seasonal_proposals(student_textbook_id);
CREATE INDEX idx_seasonal_proposal_units_proposal ON seasonal_proposal_units(proposal_id);
