-- 科目テーブルに授業時間（分）カラムを追加
-- 45分授業（主に小4以下）と90分授業（デフォルト）に対応

ALTER TABLE subjects
  ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 90
  CHECK (duration_minutes IN (45, 90));

COMMENT ON COLUMN subjects.duration_minutes IS '授業時間（分）: 45または90。小学4年生以下は45分授業の場合が多い。';
