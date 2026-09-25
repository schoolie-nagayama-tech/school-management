import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import {
  GSI_ADDRESS_SEARCH_URL,
  normalizeStationName,
  pickStationFromGsi,
} from '@/lib/geo/stationGeocode';

export const dynamic = 'force-dynamic';

/**
 * 駅名 → 緯度経度（教室設定の「駅名から位置を取得」）。
 *
 * GET /api/admin/station-geocode?name=京王永山
 *   → 200 { station: '京王永山', lat, lon }
 *   → 404 { error } … 駅として見つからない（手入力に回してもらう）
 *
 * ★認可は教室長（manager）以上＝教室設定の画面に入れる人（ROLE_PERMISSIONS.canAccessSettings）と同じ境界。
 *   保存そのものはこのルートでは行わない。値を画面に入れるだけで、保存は既存の教室設定の保存
 *   （schools の RLS＝自教室スコープ）を通る。
 *
 * ★国土地理院へはサーバーから問い合わせる。ブラウザから直接叩かせないのは、
 *   入力の検査をこちらで必ず通すためと、外部サービスの応答形式が変わったときに
 *   直す場所を1か所にするため。
 */
export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const station = normalizeStationName(request.nextUrl.searchParams.get('name'));
  if (!station) {
    return NextResponse.json(
      { error: '駅名を30文字以内で入力してください（記号は使えません）' },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    // ★クエリは encodeURIComponent で自前で組む（日本語が化けた前例があるため、組み立てを任せない）
    const url = `${GSI_ADDRESS_SEARCH_URL}?q=${encodeURIComponent(`${station}駅`)}`;
    const res = await fetch(url, {
      cache: 'no-store',
      // 外部が固まっても教室設定の画面を待たせ続けない
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`GSI ${res.status}`);
    body = await res.json();
  } catch (e) {
    console.error('station-geocode: GSI request failed', e);
    return NextResponse.json(
      { error: '位置を取得できませんでした。時間をおくか、緯度経度を手で入力してください' },
      { status: 502 }
    );
  }

  const hit = pickStationFromGsi(body, station);
  if (!hit) {
    return NextResponse.json(
      {
        error: `「${station}駅」が見つかりませんでした。駅名を確かめるか、緯度経度を手で入力してください`,
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ station, lat: hit.lat, lon: hit.lon });
}
