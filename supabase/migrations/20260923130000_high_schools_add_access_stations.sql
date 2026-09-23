-- 高校マスタに「通える駅と直線距離」を持たせる（AIヘルプの「◯◯駅から近い都立は？」用）
--
-- 中身は docs/data/toritsu-school-station-r7.csv の access_stations 列を ; で割ったもの。
-- `駅名(距離m)` の文字列のまま持つ（src/lib/ai/schoolLookup.ts の parseAccessStations で読む）。
--
-- ★距離は学校と駅の座標から出した直線距離で、歩く道のりではない。
--   公式サイトで確認して上書きした学校（station_source='手動'）は、学校が案内している駅そのもの。
--   保護者向けの「最寄駅」としては使わない（docs/data/README.md）。
-- 神奈川の行は所在地のデータがまだ無いので NULL。

ALTER TABLE public.high_schools ADD COLUMN IF NOT EXISTS access_stations text[];

COMMENT ON COLUMN public.high_schools.access_stations IS
  '通える駅と直線距離（`駅名(距離m)`）。算出=直線2km圏／手動=学校公式の案内駅。最寄駅として保護者に見せない';
