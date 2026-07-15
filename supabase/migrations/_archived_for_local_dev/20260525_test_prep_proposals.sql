-- テスト対策提案書
-- 講師が生徒ごとにテスト範囲の単元・コマ数を提案し、
-- 公開URLで保護者が閲覧→増コマ申込できるフロー

-- 提案書メタデータ
CREATE TABLE IF NOT EXISTS test_prep_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  student_id UUID NOT NULL REFERENCES students(id),
  exam_type_id UUID REFERENCES exam_types(id),
  teacher_user_id UUID REFERENCES auth.users(id),
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'published')),
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  zoukoma_period_id UUID REFERENCES form_periods(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 科目ブロック
CREATE TABLE IF NOT EXISTS test_prep_proposal_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES test_prep_proposals(id) ON DELETE CASCADE,
  subject_name TEXT NOT NULL,
  target_score INT,
  proposed_koma INT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0
);

-- 単元行
CREATE TABLE IF NOT EXISTS test_prep_proposal_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES test_prep_proposal_subjects(id) ON DELETE CASCADE,
  curriculum_item_id INT REFERENCES curriculum_items(id),
  unit_name TEXT NOT NULL,
  self_assessment TEXT CHECK (self_assessment IS NULL OR self_assessment IN ('◎', '○', '△', '×')),
  koma_count INT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0
);

-- RLS
ALTER TABLE test_prep_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_prep_proposal_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_prep_proposal_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "test_prep_proposals_all" ON test_prep_proposals
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "test_prep_proposal_subjects_all" ON test_prep_proposal_subjects
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "test_prep_proposal_units_all" ON test_prep_proposal_units
  FOR ALL USING (true) WITH CHECK (true);

-- updated_at trigger
CREATE TRIGGER set_updated_at_test_prep_proposals
  BEFORE UPDATE ON test_prep_proposals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- indexes
CREATE INDEX idx_test_prep_proposals_school ON test_prep_proposals(school_id);
CREATE INDEX idx_test_prep_proposals_student ON test_prep_proposals(student_id);
CREATE INDEX idx_test_prep_proposals_token ON test_prep_proposals(token);
CREATE INDEX idx_test_prep_proposal_subjects_proposal ON test_prep_proposal_subjects(proposal_id);
CREATE INDEX idx_test_prep_proposal_units_subject ON test_prep_proposal_units(subject_id);
