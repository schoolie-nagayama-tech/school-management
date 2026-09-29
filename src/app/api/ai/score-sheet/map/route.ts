import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { callClaudeJson, isClaudeConfigured, CLAUDE_MODELS, ClaudeError } from '@/lib/ai/claude';
import { SCORE_SHEET_FEATURE_KEY } from '@/lib/ai/features';
import {
  mapSystemPrompt,
  mapUserText,
  parseMapResult,
  type MapCandidate,
  type MapQuestion,
} from '@/lib/ai/scoreSheet';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 模試で×だった設問を、渡した単元一覧のどれに当てるか選ばせる（教室長以上）。
 * 正典: docs/score-sheet-plan-draft.md §6.2
 *
 * ★模試は回ごとに設問の内容名が変わる（「平行四辺形の面積」など）ので、対応表を作り置きできない。
 *   読み取るたびに AI に「一覧から選ぶ」だけをさせ、画面の当てはめ表で教室長が直せるようにする。
 * ★送るのは設問の番号・内容名と単元名だけ（個人の情報を含まない）。
 * ★返ってきた id は一覧にあるものだけ使う（parseMapResult）。
 */

interface MapResponse {
  mapping: Record<string, number | null>;
  degraded: boolean;
  disabled: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUESTIONS = 60;
const MAX_CANDIDATES = 400;
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: { schoolId?: unknown; questions?: unknown; candidates?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }
  const schoolId = typeof body.schoolId === 'string' ? body.schoolId : '';
  if (!UUID_RE.test(schoolId) || !auth.schoolIds.includes(schoolId)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const questions: MapQuestion[] = (Array.isArray(body.questions) ? body.questions : [])
    .slice(0, MAX_QUESTIONS)
    .map((q) => q as Record<string, unknown>)
    .filter((q) => typeof q.key === 'string' && q.key)
    .map((q) => ({
      key: clip(q.key, 40),
      subject: clip(q.subject, 10),
      area: clip(q.area, 40),
      q: clip(q.q, 20),
      content: clip(q.content, 60),
    }));
  const candidates: MapCandidate[] = (Array.isArray(body.candidates) ? body.candidates : [])
    .slice(0, MAX_CANDIDATES)
    .map((c) => c as Record<string, unknown>)
    .filter((c) => typeof c.id === 'number' && Number.isInteger(c.id))
    .map((c) => ({ id: c.id as number, label: clip(c.label, 80) }));
  if (questions.length === 0 || candidates.length === 0) {
    return NextResponse.json({ error: '対象がありません' }, { status: 400 });
  }

  const empty: MapResponse = { mapping: {}, degraded: false, disabled: false };
  const supabase = getPortalServiceClient();
  const { data: setting } = await supabase
    .from('school_ai_settings')
    .select('enabled')
    .eq('school_id', schoolId)
    .eq('feature_key', SCORE_SHEET_FEATURE_KEY)
    .maybeSingle();
  if (!setting?.enabled)
    return NextResponse.json({ ...empty, disabled: true } satisfies MapResponse);
  if (!isClaudeConfigured())
    return NextResponse.json({ ...empty, degraded: true } satisfies MapResponse);

  try {
    const raw = await callClaudeJson<unknown>({
      model: CLAUDE_MODELS.best,
      system: [{ text: mapSystemPrompt(), cache: true }],
      userText: mapUserText(questions, candidates),
      maxTokens: 3000,
      effort: 'medium',
    });
    return NextResponse.json({
      mapping: parseMapResult(raw, questions, candidates),
      degraded: raw == null,
      disabled: false,
    } satisfies MapResponse);
  } catch (e) {
    const reason = e instanceof ClaudeError ? e.reason : 'unavailable';
    console.error('[ai/score-sheet/map] failed', reason);
    return NextResponse.json({ ...empty, degraded: true } satisfies MapResponse);
  }
}
