import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove, isOwnerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { AI_FEATURE_KEYS, isAiFeatureKey, type AiFeatureKey } from '@/lib/ai/features';

export const dynamic = 'force-dynamic';

/**
 * 教室ごとのAI機能の入切（3機能まとめて1本）。
 *
 * ★機能ごとに別ルートを立てない。同じ表・同じ権限・同じ既定なのに口が増えると、
 *   片方だけ権限チェックが緩む事故が起きる。増えるのは feature の値だけ。
 *
 * ★切り替えられるのは admin/owner だけ。教室長には読ませるが変えさせない。
 *   これは費用の調整ではなく、外部（Anthropic）にデータを出してよいかの歯止めで、
 *   プライバシーポリシーのリーガルチェックが終わるまでは出せない。
 *   教室長が良かれと思って入れられる位置に置くと、その判断が現場に降りてしまう。
 *
 * ★行が無ければOFF。使う側（compose / refine / extract / concept）も同じ規約で動く。
 *
 * 正典: docs/ai-features-integration-plan.md
 */

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

  // feature を指定すれば1つ、省けば全部。画面（設定ページ）は全部を1回で取る
  const one = request.nextUrl.searchParams.get('feature');
  if (one !== null && !isAiFeatureKey(one)) {
    return NextResponse.json({ error: '機能の指定が不正です' }, { status: 400 });
  }

  const supabase = getPortalServiceClient();
  const { data } = await supabase
    .from('school_ai_settings')
    .select('feature_key, enabled')
    .eq('school_id', schoolId);

  const on = new Set(
    (data ?? []).filter((r) => r.enabled === true).map((r) => r.feature_key as string)
  );

  const canChange = isOwnerOrAbove(auth.role);

  if (one) {
    // 1機能だけ聞かれたときは、そのまま enabled を返す（バーはこれだけ見る）
    return NextResponse.json({ feature: one, enabled: on.has(one), canChange });
  }

  const features: Record<string, boolean> = {};
  for (const key of AI_FEATURE_KEYS) features[key] = on.has(key);
  return NextResponse.json({ features, canChange });
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

  let body: { schoolId?: unknown; feature?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const schoolId = typeof body.schoolId === 'string' ? body.schoolId : '';
  if (!UUID_RE.test(schoolId)) {
    return NextResponse.json({ error: '教室IDが不正です' }, { status: 400 });
  }
  if (!isAiFeatureKey(body.feature)) {
    return NextResponse.json({ error: '機能の指定が不正です' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: '指定が不正です' }, { status: 400 });
  }
  const feature: AiFeatureKey = body.feature;

  const supabase = getPortalServiceClient();
  const { error } = await supabase.from('school_ai_settings').upsert(
    {
      school_id: schoolId,
      feature_key: feature,
      enabled: body.enabled,
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'school_id,feature_key' }
  );

  if (error) {
    console.error('[ai/feature-setting] 更新に失敗', feature, error.message);
    return NextResponse.json({ error: '更新できませんでした' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, feature, enabled: body.enabled });
}
