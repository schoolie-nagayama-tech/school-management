import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove, isOwnerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { KOUSHU_CONCEPT_FEATURE_KEY } from '@/lib/bulletin/schoolSetting';

export const dynamic = 'force-dynamic';

/**
 * 講習テーマの書き足しを、この教室で使ってよいか。
 *
 * ★掲示板とはキーを分けている。掲示板は社内向けの連絡文だが、こちらは生徒の成績を送る。
 *   同じスイッチにすると、掲示板を開けた教室で成績まで流れ出す。
 *
 * ★切り替えは admin/owner だけ。教室長には状態だけ見せる（外部にデータを出す判断のため）。
 * ★行が無ければOFF。既定はどの教室もOFFで、リーガルチェックが終わるまで開けない。
 *
 * 正典: docs/ai-features-integration-plan.md §2-5
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
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
    .eq('feature_key', KOUSHU_CONCEPT_FEATURE_KEY)
    .maybeSingle();

  return NextResponse.json({
    enabled: data?.enabled === true,
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
      feature_key: KOUSHU_CONCEPT_FEATURE_KEY,
      enabled: body.enabled,
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'school_id,feature_key' }
  );

  if (error) {
    console.error('[ai/koushu/concept-setting] 更新に失敗', error.message);
    return NextResponse.json({ error: '更新できませんでした' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, enabled: body.enabled });
}
