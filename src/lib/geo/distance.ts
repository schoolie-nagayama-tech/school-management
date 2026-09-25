/**
 * 2点間の距離と、自転車での所要時間の目安。
 *
 * 使いどころ: 面談で「教室の最寄り駅（schools.nearest_station_*）から志望校まで」の目安を出す。
 * ★起点は教室の最寄り駅で、生徒の住所は使わない（docs/interview-workspace-layout-2026-09.md）。
 *
 * ★直線距離であって道のりではない。実際の道のりは直線の1.2〜1.4倍ほどになるのがふつうなので、
 *   画面では「目安」「直線」と必ず添える。ここで係数を掛けて道のりっぽく見せることはしない
 *   （根拠の無い数字を、それらしく見せるほうが害が大きい）。
 *
 * なお src/lib/ai/schoolLookup.ts にも平面近似の距離計算があるが、あちらはAIヘルプの
 * 候補の並べ替えにしか使わない内部関数なので、そのままにしている。
 */

/** 地球の平均半径（km）。国際測地学協会の平均半径 R1 */
const EARTH_RADIUS_KM = 6371.0088;

/** 自転車の想定速度（km/h）。中高生が街中を走る速さの控えめな目安 */
export const BIKE_SPEED_KMH = 15;

/**
 * 2点間の直線距離（km）。ハバーサイン公式。
 * 緯度経度は度。範囲外の値でも例外は投げない（呼び出し側で null を弾く前提）。
 */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  // 丸め誤差で h が 1 をわずかに超えると asin が NaN になるので抑える
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 自転車で何分かかるかの目安（15km/h・分単位で切り上げ）。
 * ★切り上げにしているのは、目安が実際より短く出ると「思ったより遠い」になるため。
 *   長めに見積もって外すほうが、面談の場では害が小さい。
 * 0km は 0分。負の値・NaN は 0分として扱う（壊れた入力で画面を落とさない）。
 */
export function estimateBikeMinutes(km: number): number {
  if (!Number.isFinite(km) || km <= 0) return 0;
  // 浮動小数の誤差で 2.0000000001 分 → 3分 にならないよう、ごく小さい値を引いてから切り上げる
  return Math.ceil((km / BIKE_SPEED_KMH) * 60 - 1e-9);
}
