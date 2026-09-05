import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove, isOwnerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';

export const dynamic = 'force-dynamic';

/**
 * 教室ごとの「掲示板の読み取り」の入切。
 *
 * ★切り替えられるのは admin/owner だけ。教室長には読ませるが変えさせない。
 *   これは費用の調整ではなく、投稿の本文を外部（Anthropic）に出してよいかの歯止めで、
 *   プライバシーポリシーのリーガルチェックが終わるまでは出せない。
 *   教室長が良かれと思って入れられる位置に置くと、その判断が現場に降りてしまう。
 *
 * ★行が無ければOFF。読み取り側（extract）も同じ規約で動く。
 *
 * 正典: docs/bulletin-ai-assist.html
 */

const FEATURE_KEY = 'bulletin_extract';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  // 読むのは教室長以上。自分の教室がどちらなのかは知れてよい
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const schoolId = request.nextUrl.searchParams.get('school_id') ?? '';
  if (!UUID_RE.test(schoolId)) {
    return NextResponse.json({ error: '教室IDが不正です' }, { status: 400 });
  }
  if (!auth.schoolIds.includes(schoolId)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const supabase = getPortalServiceClient();
  const { data } = await supabase
    .from('school_ai_settings')
    .select('enabled')
    .eq('school_id', schoolId)
    .eq('feature_key', FEATURE_KEY)
    .maybeSingle();

  return NextResponse.json({
    enabled: data?.enabled === true,
    // 画面がスイッチを押せるかの判断に使う
    canChange: isOwnerOrAbove(auth.role),
  });
}

export async function PATCH(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  // ★変えられるのは admin/owner だけ
  if (!isOwnerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: { schoolId?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const schoolId = typeof body.schoolId === 'string' ? body.schoolId : '';
  if (!UUID_RE.test(schoolId)) {
    return NextResponse.json({ error: '教室IDが不正です' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: '指定が不正です' }, { status: 400 });
  }

  const supabase = getPortalServiceClient();

  const { error } = await supabase.from('school_ai_settings').upsert(
    {
      school_id: schoolId,
      feature_key: FEATURE_KEY,
      enabled: body.enabled,
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'school_id,feature_key' }
  );

  if (error) {
    console.error('[ai/bulletin/school-setting] 更新に失敗', error.message);
    return NextResponse.json({ error: '更新できませんでした' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, enabled: body.enabled });
}
