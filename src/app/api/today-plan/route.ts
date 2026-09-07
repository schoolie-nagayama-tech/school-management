import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { describePlanBlocks, planBlocksForSchool, validatePlanForSave } from '@/lib/ai/todayPlan';
import { fetchPlanSlots } from '@/lib/ai/todayPlanMaterials';
import { loadPlan, savePlan, PLAN_DATE_RE, PLAN_UUID_RE } from '@/lib/ai/todayPlanStore';

export const dynamic = 'force-dynamic';

/**
 * 今日の段取りの読み書き。
 *
 * ★ここはAIを呼ばない。読むのも保存するのも、AIがオフの教室でも通ってよい
 *   （オフにした瞬間に、それまで手で直した段取りが読めなくなるほうが困る）。
 *   AIを呼ぶのは /api/ai/today-plan/generate と /place の2本だけ。
 *
 * ★教室長以上。段取りは教室長ひとりの1日の組み立てで、講師には出さない。
 *
 * ★PATCH は丸ごと置き換え。直した結果が正典なので、差分で当てない
 *   （差分だと「消した」と「まだ届いていない」が区別できず、消した項目が復活する）。
 *
 * 正典: docs/today-plan-ai-plan.md
 */

export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const schoolId = request.nextUrl.searchParams.get('school_id') ?? '';
  if (!PLAN_UUID_RE.test(schoolId)) {
    return NextResponse.json({ error: '教室IDが不正です' }, { status: 400 });
  }
  if (!auth.schoolIds.includes(schoolId)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const date = request.nextUrl.searchParams.get('date') ?? '';
  if (!PLAN_DATE_RE.test(date)) {
    return NextResponse.json({ error: '日付が不正です' }, { status: 400 });
  }

  const supabase = getPortalServiceClient();
  const [{ slots }, stored] = await Promise.all([
    fetchPlanSlots(supabase, schoolId),
    loadPlan(supabase, schoolId, date),
  ]);

  return NextResponse.json({
    plan: stored.plan,
    generatedAt: stored.generatedAt,
    blocks: describePlanBlocks(slots),
  });
}

export async function PATCH(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: { schoolId?: unknown; date?: unknown; plan?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const schoolId = typeof body.schoolId === 'string' ? body.schoolId : '';
  if (!PLAN_UUID_RE.test(schoolId)) {
    return NextResponse.json({ error: '教室IDが不正です' }, { status: 400 });
  }
  if (!auth.schoolIds.includes(schoolId)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const date = typeof body.date === 'string' ? body.date : '';
  if (!PLAN_DATE_RE.test(date)) {
    return NextResponse.json({ error: '日付が不正です' }, { status: 400 });
  }

  const supabase = getPortalServiceClient();

  /**
   * ★保存してよい block はその教室のコマから作る。
   *   ここを省くと、他教室のコマIDや作り話のIDを付けた行が入り、
   *   画面のどの見出しにも属さない＝消えて見える行ができる。
   */
  const { slots } = await fetchPlanSlots(supabase, schoolId);
  const plan = validatePlanForSave(body.plan, planBlocksForSchool(slots));
  if (!plan) {
    return NextResponse.json({ error: '段取りの形が不正です' }, { status: 400 });
  }

  const ok = await savePlan(supabase, { schoolId, date, plan, userId: auth.userId });
  if (!ok) {
    return NextResponse.json({ error: '保存できませんでした' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: plan.length });
}
