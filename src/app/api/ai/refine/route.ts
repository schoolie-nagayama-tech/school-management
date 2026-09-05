import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { callClaudeJson, isClaudeConfigured, CLAUDE_MODELS, ClaudeError } from '@/lib/ai/claude';
import {
  MAX_LINES,
  parseRefineResult,
  refineSystemPrompt,
  refineUserText,
  type RefineKind,
  type RefineLine,
  type RefineResult,
} from '@/lib/ai/refine';
import { BULLETIN_AI_FEATURE_KEY } from '@/lib/bulletin/schoolSetting';

export const dynamic = 'force-dynamic';

/**
 * 文章を整える（教室長以上）。
 *
 * ★AIは書かない。渡された行を整えて、同じ番号で返すだけ。
 *   行を増やす・減らす・順番を変えるは、パーサ側で機械的に弾く。
 *
 * ★教室ごとの栓を通る。整えるのも投稿の本文をそのまま外部（Anthropic）へ送るので、
 *   読み取りと同じ判断が要る（プライバシーポリシーがリーガルチェック中）。
 *   スイッチを機能ごとに分けないのは、送るデータも判断も同じものだから。
 *
 * 正典: docs/ai-features-integration-plan.md
 */

interface RefineResponse extends RefineResult {
  /** AIを呼べなかった。画面は「整えられませんでした」と出して本文は触らない */
  degraded: boolean;
  /** この教室ではAIに送らない設定。故障ではなく意図した停止 */
  disabled: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KINDS: ReadonlySet<string> = new Set<RefineKind>(['bulletin']);

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: { kind?: unknown; schoolId?: unknown; lines?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const kind =
    typeof body.kind === 'string' && KINDS.has(body.kind) ? (body.kind as RefineKind) : null;
  if (!kind) {
    return NextResponse.json({ error: '種類の指定が不正です' }, { status: 400 });
  }

  const schoolId = typeof body.schoolId === 'string' ? body.schoolId : '';
  if (!UUID_RE.test(schoolId)) {
    return NextResponse.json({ error: '教室IDが不正です' }, { status: 400 });
  }
  if (!auth.schoolIds.includes(schoolId)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  // 行の検証。★形が違うものはここで落とす（AIに変な入力を渡さない）
  const rawLines = Array.isArray(body.lines) ? body.lines : null;
  if (!rawLines || rawLines.length === 0) {
    return NextResponse.json({ error: '整える文章がありません' }, { status: 400 });
  }
  const lines: RefineLine[] = [];
  for (const row of rawLines.slice(0, MAX_LINES)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as { index?: unknown; text?: unknown };
    if (typeof r.index !== 'number' || !Number.isInteger(r.index)) continue;
    if (typeof r.text !== 'string' || !r.text.trim()) continue;
    lines.push({ index: r.index, text: r.text });
  }
  if (lines.length === 0) {
    return NextResponse.json({ error: '整える文章がありません' }, { status: 400 });
  }

  const empty: RefineResponse = { lines, changes: [], degraded: false, disabled: false };

  // ★この教室でAIに送ってよいか。読み取りと同じ栓（行が無ければOFF）
  const supabase = getPortalServiceClient();
  const { data: setting } = await supabase
    .from('school_ai_settings')
    .select('enabled')
    .eq('school_id', schoolId)
    .eq('feature_key', BULLETIN_AI_FEATURE_KEY)
    .maybeSingle();

  if (!setting?.enabled) {
    return NextResponse.json({ ...empty, disabled: true } satisfies RefineResponse);
  }

  if (!isClaudeConfigured()) {
    return NextResponse.json({ ...empty, degraded: true } satisfies RefineResponse);
  }

  try {
    const raw = await callClaudeJson<unknown>({
      model: CLAUDE_MODELS.fast,
      // 決まりは毎回同じなのでキャッシュに載せる
      system: [{ text: refineSystemPrompt(kind), cache: true }],
      userText: refineUserText(lines),
      maxTokens: 2000,
    });
    const result = parseRefineResult(raw, lines);
    return NextResponse.json({
      ...result,
      degraded: false,
      disabled: false,
    } satisfies RefineResponse);
  } catch (e) {
    const reason = e instanceof ClaudeError ? e.reason : 'unavailable';
    console.error('[ai/refine] failed', reason, e);
    // ★整えられなくても本文は書けている。元のまま返す（勝手に書き換えない）
    return NextResponse.json({ ...empty, degraded: true } satisfies RefineResponse);
  }
}
