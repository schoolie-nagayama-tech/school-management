-- schools に「最寄り駅」とその位置（緯度経度）を追加する
--
-- 背景: 面談ワークスペースで、志望校までの通学時間（直線距離・自転車の目安）を出したい。
--   起点は教室の最寄り駅にする。★生徒の住所は使わない。
--   住所を扱うと個人情報の持ち方・AIへの送り方まで話が広がる一方、同じ教室に通う生徒の
--   生活圏はほぼ重なるので、教室の最寄り駅で「どのくらい遠いか」の目安としては十分。
--
-- なぜ緯度経度まで持つか: 距離の計算を画面を開くたびに外部APIへ問い合わせない（遅い・落ちる）。
--   駅名は人が読む用、緯度経度は計算用。教室設定の「駅名から位置を取得」で埋め、手で直せる。
--
-- 空（NULL）は「未設定」＝通学時間の目安を出さない。既存の動きは何も変わらない（後方互換）。
--
-- 既定値（実在4教室）の座標の出典:
--   国土地理院 地名検索API（https://msearch.gsi.go.jp/address-search/AddressSearch）で
--   「◯◯駅」を引き、title が駅名と完全一致した地物（dataSource=1）の座標を 2026-09-24 に取得。
--   ★リポジトリには国土数値情報 N02（鉄道データ）の生データを置いていない
--   （docs/data/toritsu-school-station-r7.csv は駅名・距離だけで駅の座標を持たない）ため、こちらを使った。
--   小数6桁（約0.1m）に丸めている。通学時間の目安に使うだけなので精度はこれで余る。
--
-- ロールバック:
--   ALTER TABLE public.schools
--     DROP COLUMN IF EXISTS nearest_station,
--     DROP COLUMN IF EXISTS nearest_station_lat,
--     DROP COLUMN IF EXISTS nearest_station_lon;

alter table public.schools
  add column if not exists nearest_station text,
  add column if not exists nearest_station_lat double precision,
  add column if not exists nearest_station_lon double precision;

comment on column public.schools.nearest_station is
  '教室の最寄り駅（「駅」は付けない）。高校までの通学時間の目安を、この駅を起点に計算する（生徒の住所は使わない）。NULL=未設定。';
comment on column public.schools.nearest_station_lat is
  '最寄り駅の緯度（世界測地系）。教室設定で国土地理院の地名検索から取得し、手で直せる。';
comment on column public.schools.nearest_station_lon is
  '最寄り駅の経度（世界測地系）。教室設定で国土地理院の地名検索から取得し、手で直せる。';

-- 実在4教室の既定値。
-- ★すでに値が入っている教室は上書きしない（教室設定で直した値を、再適用で戻さないため）。
update public.schools as s
set
  nearest_station = v.station,
  nearest_station_lat = v.lat,
  nearest_station_lon = v.lon
from (
  values
    ('9f519794-3673-4e90-b1ea-88a79f70174a'::uuid, '京王堀之内', 35.624357::double precision, 139.400532::double precision), -- 京王堀之内校
    ('d187f7a3-633a-46ce-8d32-c56c85d17bac'::uuid, '京王永山', 35.633133, 139.447712), -- 永山校
    ('e26b398c-8e30-47bc-b528-ee92fd45be7f'::uuid, '清瀬', 35.772011, 139.519817), -- 清瀬校
    ('9a6b5996-a266-47ed-878f-85e93c2b8b90'::uuid, '緑園都市', 35.439822, 139.522077) -- 緑園都市校
) as v(id, station, lat, lon)
where s.id = v.id
  and s.nearest_station is null;
