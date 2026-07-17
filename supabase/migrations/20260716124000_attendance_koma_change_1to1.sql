-- コマ給変更を指導形態別（1対2 / 1対1）に持てるようにする。
--
-- コマ給は 1対2 と 1対1 で別建てなので、1講師・1ヶ月あたり最大2件の変更が発生する。
-- 既存の koma_change_from/to は「1対2」枠としてそのまま使い続け（過去データを移行せずに済む）、
-- 1対1 用の枠を追加する。指導形態が今後増える場合はこの2枠では足りなくなるため、
-- そのときは別テーブルへの正規化を検討すること。
--
-- is_koma_changing は「どちらか一方でも変更あり」を表すフラグ（バッジ表示・絞り込みに使用）。
ALTER TABLE attendance_sheets
  ADD COLUMN IF NOT EXISTS koma_change_from_1to1 integer,
  ADD COLUMN IF NOT EXISTS koma_change_to_1to1 integer;

COMMENT ON COLUMN attendance_sheets.koma_change_from IS 'コマ給変更(1対2)の旧コマ給。NULL=1対2の変更なし';
COMMENT ON COLUMN attendance_sheets.koma_change_to IS 'コマ給変更(1対2)の新コマ給。NULL=1対2の変更なし';
COMMENT ON COLUMN attendance_sheets.koma_change_from_1to1 IS 'コマ給変更(1対1)の旧コマ給。NULL=1対1の変更なし';
COMMENT ON COLUMN attendance_sheets.koma_change_to_1to1 IS 'コマ給変更(1対1)の新コマ給。NULL=1対1の変更なし';
COMMENT ON COLUMN attendance_sheets.is_koma_changing IS '1対2・1対1のいずれかにコマ給変更があるか。バッジ表示・絞り込み用の導出フラグ';
