import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { callClaudeJson, isClaudeConfigured, CLAUDE_MODELS, ClaudeError } from '@/lib/ai/claude';
import { PLAN_THEME_FEATURE_KEY } from '@/lib/ai/features';
import {
  parseThemeResult,
  sanitizeThemeInputs,
  themeSystemPrompt,
  themeUserText,
  type ThemeResult,
} from '@/lib/ai/scoreSheetTheme';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 成績表から作った下書きの講習テーマを書く（教室長以上）。
 * 正典: docs/score-sheet-plan-draft.md §7.1
 *
 * ★材料は画面から受け取る（下書きはまだ保存されていないので、DB から引けない）。
 *   受け取るのは単元・コマ・目的タグ・根拠の札だけで、氏名や偏差値は画面が送らない。
 * ★AI の栓は「テーマふくらませ」（plan_theme）と同じ。送るもの（生徒の単元と成績）が同じ種類なので、
 *   新しい栓を作って教室長に2回オンにさせない。
 * ★書き込まない。返すだけで、欄に入れるか・保存するかは画面が決める。
 */

interface ThemeResponse {
  results: ThemeResult[];
  degraded: boolean;
  disabled: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: { schoolId?: unknown; inputs?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }
  const schoolId = typeof body.schoolId === 'string' ? body.schoolId : '';
  if (!UUID_RE.test(schoolId) || !auth.schoolIds.includes(schoolId)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }
  const inputs = sanitizeThemeInputs(body.inputs);
  if (inputs.length === 0) {
    return NextResponse.json({ error: '対象がありません' }, { status: 400 });
  }

  const empty: ThemeResponse = { results: [], degraded: false, disabled: false };
  const supabase = getPortalServiceClient();
  const { data: setting } = await supabase
    .from('school_ai_settings')
    .select('enabled')
    .eq('school_id', schoolId)
    .eq('feature_key', PLAN_THEME_FEATURE_KEY)
    .maybeSingle();
  if (!setting?.enabled) {
    return NextResponse.json({ ...empty, disabled: true } satisfies ThemeResponse);
  }
  if (!isClaudeConfigured()) {
    return NextResponse.json({ ...empty, degraded: true } satisfies ThemeResponse);
  }

  try {
    const raw = await callClaudeJson<unknown>({
      // テーマふくらませと同じ。文を組み立てるので smart
      model: CLAUDE_MODELS.smart,
      system: [{ text: themeSystemPrompt(), cache: true }],
      userText: themeUserText(inputs),
      maxTokens: 2000,
    });
    const results = parseThemeResult(raw, inputs);
    return NextResponse.json({
      results,
      degraded: results.length === 0,
      disabled: false,
    } satisfies ThemeResponse);
  } catch (e) {
    const reason = e instanceof ClaudeError ? e.reason : 'unavailable';
    console.error('[ai/score-sheet/theme] failed', reason);
    return NextResponse.json({ ...empty, degraded: true } satisfies ThemeResponse);
  }
}
