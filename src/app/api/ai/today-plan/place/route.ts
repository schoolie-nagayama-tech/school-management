import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { callClaudeJson, isClaudeConfigured, CLAUDE_MODELS, ClaudeError } from '@/lib/ai/claude';
import {
  parsePlaceResult,
  placeSystemPrompt,
  placeUserText,
  planBlocksForSchool,
  sanitizePlanTodos,
  MAX_SAVED_TEXT_LENGTH,
  type PlanItem,
  type PlanPlacement,
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
 * 日中に増えた用事を1件だけ差し込む。
 *
 * ★決めさせるのは入れ場所だけ。いまの段取りは空き具合を見せるために渡すだけで、
 *   AIには一切書き換えさせない。全部組み直すと、手で直した並びが吹き飛ぶ。
 *
 * ★AIが答えられなくても、用事は必ず足す。
 *   置き場所が決まらないことより、打ち込んだ用事が消えることのほうが最悪。
 *   決められなければ「授業前」に置いて、そう書いた理由を why に残す。
 *
 * ★教室ごとの栓を通る（today_plan・行が無ければOFF）。ここは足さずに disabled を返す
 *   （オフの教室では画面ごと出していないので、そもそもここへ来ない）。
 *
 * 正典: docs/today-plan-ai-plan.md
 */

interface PlaceResponse {
  /** 足した1件。disabled のときだけ null */
  item: PlanItem | null;
  /** AIを呼べなかった。それでも item は足してある */
  degraded: boolean;
  disabled: boolean;
}

/** AIが決められなかったときの置き場所。★ここに置けば必ず目に入る */
const FALLBACK: PlanPlacement = {
  block: 'before',
  why: 'AIが決められなかったので授業前に置きました',
};

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: { schoolId?: unknown; text?: unknown; date?: unknown; todos?: unknown };
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

  const date = typeof body.date === 'string' && PLAN_DATE_RE.test(body.date) ? body.date : '';
  if (!date) {
    return NextResponse.json({ error: '日付が不正です' }, { status: 400 });
  }

  const text = (typeof body.text === 'string' ? body.text : '').trim();
  if (!text) {
    return NextResponse.json({ error: '用事が空です' }, { status: 400 });
  }
  if (text.length > MAX_SAVED_TEXT_LENGTH) {
    return NextResponse.json({ error: '用事が長すぎます' }, { status: 400 });
  }

  const supabase = getPortalServiceClient();

  if (!(await isTodayPlanEnabled(supabase, schoolId))) {
    return NextResponse.json({
      item: null,
      degraded: false,
      disabled: true,
    } satisfies PlaceResponse);
  }

  // ★用事は画面の「今日やること」から受け取る（組むときと同じ材料で入れ場所を決める）
  const todos = sanitizePlanTodos(body.todos);

  const [materials, stored] = await Promise.all([
    buildPlanMaterials(supabase, schoolId, date, todos, auth.userId),
    loadPlan(supabase, schoolId, date),
  ]);

  let placement: PlanPlacement | null = null;
  let degraded = false;

  if (!isClaudeConfigured()) {
    degraded = true;
  } else {
    try {
      const raw = await callClaudeJson<unknown>({
        // 1件の置き場所を選ぶだけなので fast で足りる
        model: CLAUDE_MODELS.fast,
        system: [{ text: placeSystemPrompt(), cache: true }],
        userText: placeUserText({ materials, currentPlan: stored.plan, text }),
        maxTokens: 300,
      });

      placement = parsePlaceResult(raw, {
        allowedBlocks: planBlocksForSchool(materials.slots),
        allowedDays: materials.upcomingLessonDays,
      });
      if (!placement) degraded = true;
    } catch (e) {
      const reason = e instanceof ClaudeError ? e.reason : 'unavailable';
      console.error('[ai/today-plan/place] failed', reason, e);
      degraded = true;
    }
  }

  const decided = placement ?? FALLBACK;

  /**
   * ★source は 'user'。入れ場所をAIが決めただけで、用事そのものは人が打ち込んだもの。
   *   'ai' にすると、あとから「AIが作った項目」を見分けたいときに嘘になる。
   */
  const item: PlanItem = {
    id: randomUUID(),
    block: decided.block,
    text,
    why: decided.why,
    done: false,
    source: 'user',
    ...(decided.when ? { when: decided.when } : {}),
  };

  const ok = await savePlan(supabase, {
    schoolId,
    date,
    plan: [...stored.plan, item],
    userId: auth.userId,
  });
  if (!ok) {
    return NextResponse.json({ error: '保存できませんでした' }, { status: 500 });
  }

  return NextResponse.json({ item, degraded, disabled: false } satisfies PlaceResponse);
}
