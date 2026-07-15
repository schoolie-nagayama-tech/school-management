-- 生徒に兄弟フラグを追加
ALTER TABLE students ADD COLUMN IF NOT EXISTS is_sibling boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN students.is_sibling IS '兄弟・姉妹がいる場合 true';
