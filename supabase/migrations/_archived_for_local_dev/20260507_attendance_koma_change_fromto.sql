-- コマ給変更: 旧コマ給→新コマ給を保存するカラムを追加
ALTER TABLE attendance_sheets
  ADD COLUMN IF NOT EXISTS koma_change_from integer,
  ADD COLUMN IF NOT EXISTS koma_change_to integer;
