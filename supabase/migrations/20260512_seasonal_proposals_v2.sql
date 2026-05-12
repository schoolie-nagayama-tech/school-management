-- 講習提案書 v2: テキスト未所持でもプラン作成可能に + 申込コマ数 + 単元グルーピング

-- 1. seasonal_proposals に列追加
ALTER TABLE seasonal_proposals
  ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS textbook_id INT REFERENCES textbooks(id),
  ADD COLUMN IF NOT EXISTS applied_koma INT;

-- 2. student_textbook_id を nullable に
ALTER TABLE seasonal_proposals
  ALTER COLUMN student_textbook_id DROP NOT NULL;

-- 3. 既存データの student_id を student_textbooks から逆引きして埋める
UPDATE seasonal_proposals sp
SET student_id = st.student_id,
    textbook_id = st.textbook_id
FROM student_textbooks st
WHERE sp.student_textbook_id = st.id
  AND sp.student_id IS NULL;

-- 4. 旧ユニーク制約を削除して新しい制約に変更
-- (student_textbook_id, season, year) → (student_id, textbook_id, season, year)
ALTER TABLE seasonal_proposals
  DROP CONSTRAINT IF EXISTS seasonal_proposals_student_textbook_id_season_year_key;

ALTER TABLE seasonal_proposals
  ADD CONSTRAINT seasonal_proposals_student_textbook_season_year_key
    UNIQUE (student_id, textbook_id, season, year);

-- 5. seasonal_proposal_units に group_id 追加
ALTER TABLE seasonal_proposal_units
  ADD COLUMN IF NOT EXISTS group_id INT NOT NULL DEFAULT 0;

-- 6. indexes
CREATE INDEX IF NOT EXISTS idx_seasonal_proposals_student ON seasonal_proposals(student_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_proposals_textbook ON seasonal_proposals(textbook_id);
