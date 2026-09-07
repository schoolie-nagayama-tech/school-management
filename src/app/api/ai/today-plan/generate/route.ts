import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { callClaudeJson, isClaudeConfigured, CLAUDE_MODELS, ClaudeError } from '@/lib/ai/claude';
import {
  parsePlanResult,
  planBlocksForSchool,
  planSystemPrompt,
  planUserText,
  type PlanItem,
} from '@/lib/ai/todayPlan';
import { buildPlanMaterials } from '@/lib/ai/todayPlanMaterials';
import {
  isTodayPlanEnabled,
  loadPlan,
  savePlan,
  PLAN_DATE_RE,
  PLAN_UUID_RE,
} from '@/lib/ai/todayPlanStore';

export const dynamic = 'force-dynamic';

/**
 * 今日の段取りを組む（朝に1回）。
 *
 * ★組み直さない。generated_at が入っていて段取りが空でなければ、
 *   材料も読まずAIも呼ばずに alreadyGenerated で返す。
 *   組み直すと、その日に手で直した並び・消した項目・書き換えた本文が全部消える。
 *   日中に増えた用事は /place で1件ずつ差し込む（そちらは既存の段取りに触らない）。
 *
 * ★教室ごとの栓を通る（today_plan・行が無ければOFF）。
 *
 * 正典: docs/today-plan-ai-plan.md
 */

interface GenerateResponse {
  plan: PlanItem[];
  generatedAt: string | null;
  /** すでに組んである。★作り直していない */
  alreadyGenerated: boolean;
  /** AIを呼べなかった。故障側 */
  degraded: boolean;
  /** この教室ではAIに送らない設定。故障ではなく意図した停止 */
  disabled: boolean;
}

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: { schoolId?: unknown; date?: unknown };
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

  // 日付は画面（教室のローカル時刻）が送る。サーバーのUTCで決めると日付が1日ずれる
  const date = typeof body.date === 'string' && PLAN_DATE_RE.test(body.date) ? body.date : '';
  if (!date) {
    return NextResponse.json({ error: '日付が不正です' }, { status: 400 });
  }

  const supabase = getPortalServiceClient();

  const empty: GenerateResponse = {
    plan: [],
    generatedAt: null,
    alreadyGenerated: false,
    degraded: false,
    disabled: false,
  };

  if (!(await isTodayPlanEnabled(supabase, schoolId))) {
    return NextResponse.json({ ...empty, disabled: true } satisfies GenerateResponse);
  }

  /**
   * ★すでに組んであるならここで止める（作り直さない）。
   *   generated_at だけでなく中身も見るのは、AIが何も置けなかった日に
   *   二度と組めなくなるのを避けるため。項目が1件でもある日は、
   *   手で直した並びが乗っているとみなして触らない。
   */
  const stored = await loadPlan(supabase, schoolId, date);
  if (stored.generatedAt && stored.plan.length > 0) {
    return NextResponse.json({
      plan: stored.plan,
      generatedAt: stored.generatedAt,
      alreadyGenerated: true,
      degraded: false,
      disabled: false,
    } satisfies GenerateResponse);
  }

  if (!isClaudeConfigured()) {
    return NextResponse.json({ ...empty, degraded: true } satisfies GenerateResponse);
  }

  const materials = await buildPlanMaterials(supabase, schoolId, date);

  // 用事が1件も無い日は組む必要がない。故障ではないので degraded は立てない
  if (materials.todos.length === 0) {
    const generatedAt = new Date().toISOString();
    await savePlan(supabase, { schoolId, date, plan: [], userId: auth.userId, generatedAt });
    return NextResponse.json({
      ...empty,
      generatedAt,
    } satisfies GenerateResponse);
  }

  try {
    const raw = await callClaudeJson<unknown>({
      // 用事とコマを突き合わせて置き場所を決める仕事なので smart
      model: CLAUDE_MODELS.smart,
      // 組み方の決まりは毎回同じなのでキャッシュに載せる
      system: [{ text: planSystemPrompt(), cache: true }],
      userText: planUserText(materials),
      maxTokens: 2000,
    });

    const drafts = parsePlanResult(raw, {
      allowedBlocks: planBlocksForSchool(materials.slots),
      allowedTodoIds: materials.todos.map((t) => t.id),
      allowedDays: materials.upcomingLessonDays,
    });

    if (drafts.length === 0) {
      // 読めなかった。★中途半端に保存しない（generated_at も立てない＝もう一度押せる）
      return NextResponse.json({ ...empty, degraded: true } satisfies GenerateResponse);
    }

    // ★IDはサーバーで振る。AIに作らせると重複したり、あとで消せない行ができる
    const plan: PlanItem[] = drafts.map(
      (d): PlanItem => ({
        id: randomUUID(),
        block: d.block,
        text: d.text,
        why: d.why,
        done: false,
        source: 'ai',
        ...(d.todoId ? { todoId: d.todoId } : {}),
        ...(d.when ? { when: d.when } : {}),
      })
    );

    const generatedAt = new Date().toISOString();
    const ok = await savePlan(supabase, { schoolId, date, plan, userId: auth.userId, generatedAt });
    if (!ok) {
      return NextResponse.json({ ...empty, degraded: true } satisfies GenerateResponse);
    }

    return NextResponse.json({
      plan,
      generatedAt,
      alreadyGenerated: false,
      degraded: false,
      disabled: false,
    } satisfies GenerateResponse);
  } catch (e) {
    const reason = e instanceof ClaudeError ? e.reason : 'unavailable';
    console.error('[ai/today-plan/generate] failed', reason, e);
    return NextResponse.json({ ...empty, degraded: true } satisfies GenerateResponse);
  }
}
