-- schools テーブルに is_demo フラグを追加
-- デモ用の教室（デフォルト教室など）を非表示にするためのフラグ

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

-- デフォルト教室（code = 'DEFAULT'）をデモ教室としてマーク
UPDATE schools
  SET is_demo = TRUE
  WHERE code = 'DEFAULT';

COMMENT ON COLUMN schools.is_demo IS 'デモ用教室フラグ。TRUE の場合、教室選択ドロップダウンなどから非表示にする。';
