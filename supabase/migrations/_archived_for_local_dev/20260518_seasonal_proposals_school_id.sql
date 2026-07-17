-- seasonal_proposals に school_id を追加（school 単位でのフィルタ・隔離用）

ALTER TABLE seasonal_proposals
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id);

-- 既存データの school_id を students テーブルから逆引きして埋める
UPDATE seasonal_proposals sp
SET school_id = s.school_id
FROM students s
WHERE sp.student_id = s.id
  AND sp.school_id IS NULL;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_seasonal_proposals_school ON seasonal_proposals(school_id);
