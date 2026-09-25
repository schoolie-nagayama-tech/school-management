/**
 * 駅名 → 緯度経度（国土地理院 地名検索API）の、通信を含まない部分。
 *
 * 通信は /api/admin/station-geocode が行う。ここは入力の整形と、応答から駅を選ぶところだけ
 * （テストで確かめられるように切り出している）。
 *
 * ★応答の選び方: 「清瀬駅」で引くと「東京都清瀬市」「清瀬駅前郵便局」「東村山警察署清瀬駅前交番」
 *   なども返る。部分一致で先頭を取ると駅前の郵便局の座標になってしまうので、
 *   title が「◯◯駅」と完全一致するものだけを採る。無ければ「見つからない」を返し、
 *   手入力に回してもらう（それらしい別の場所を黙って入れない）。
 */

export const GSI_ADDRESS_SEARCH_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch';

/** 駅名の長さの上限。日本の駅名で最長級でも20文字台なので、余裕を見て30 */
export const STATION_NAME_MAX = 30;

/**
 * 入力された駅名を整える。空・長すぎ・記号混じりは null（検索しない）。
 * 末尾の「駅」は外す（保存する駅名は「駅」なし。検索するときに付け直す）。
 */
export function normalizeStationName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let name = input.normalize('NFKC').trim().replace(/\s+/g, '');
  if (name.endsWith('駅')) name = name.slice(0, -1);
  if (name.length === 0 || name.length > STATION_NAME_MAX) return null;
  // 駅名に使われる文字だけ通す（かな・カナ・漢字・英数・長音・ヶ・々・中黒・ハイフン・括弧）。
  // 外部APIへそのまま渡すので、URLや制御文字を混ぜさせない。
  if (
    !/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9ー々ヶヵ・\-()]+$/u.test(name)
  ) {
    return null;
  }
  return name;
}

type GsiFeature = {
  geometry?: { coordinates?: unknown };
  properties?: { title?: unknown };
};

/** 応答から「◯◯駅」と完全一致する地物を探し、緯度経度を返す。無ければ null */
export function pickStationFromGsi(
  response: unknown,
  stationName: string
): { lat: number; lon: number } | null {
  if (!Array.isArray(response)) return null;
  const want = `${stationName}駅`;
  for (const f of response as GsiFeature[]) {
    if (f?.properties?.title !== want) continue;
    const c = f.geometry?.coordinates;
    // GeoJSON なので [経度, 緯度] の順
    if (!Array.isArray(c) || c.length < 2) continue;
    const lon = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // 日本の範囲外は採らない（同名の別物や壊れた値を弾く）
    if (lat < 20 || lat > 46 || lon < 122 || lon > 154) continue;
    // 小数6桁（約0.1m）に丸める。これ以上の桁は意味が無く、画面で読みにくいだけ
    return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
  }
  return null;
}
