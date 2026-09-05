import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { callClaudeJson, isClaudeConfigured, CLAUDE_MODELS, ClaudeError } from '@/lib/ai/claude';
import {
  composeSystemPrompt,
  composeUserText,
  MAX_BLOCKS,
  MAX_BLOCK_LENGTH,
  parseComposeResult,
  type ComposeResult,
} from '@/lib/ai/compose';
import { BULLETIN_AI_FEATURE_KEY } from '@/lib/bulletin/schoolSetting';

export const dynamic = 'force-dynamic';

/**
 * 指示から本文の下書きを作る（教室長以上）。
 *
 * ★整える（/api/ai/refine）と分ける。白紙から作るのと、書いたものを直すのは別の作業で、
 *   同じ入口にすると「押したら全部書き換わった」が起きる。
 *
 * ★教室ごとの栓を通る。下書きも本文を外部（Anthropic）へ送るので、
 *   読み取り・整えると同じ判断が要る（プライバシーポリシーがリーガルチェック中）。
 *
 * 正典: docs/ai-features-integration-plan.md
 */

interface ComposeResponse extends ComposeResult {
  /** AIを呼べなかった。画面は本文を触らない */
  degraded: boolean;
  /** この教室ではAIに送らない設定。故障ではなく意図した停止 */
  disabled: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 指示の長さの上限。箇条書き数行を想定 */
const MAX_INSTRUCTION = 1000;

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: { schoolId?: unknown; instruction?: unknown; currentLines?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const schoolId = typeof body.schoolId === 'string' ? body.schoolId : '';
  if (!UUID_RE.test(schoolId)) {
    return NextResponse.json({ error: '教室IDが不正です' }, { status: 400 });
  }
  if (!auth.schoolIds.includes(schoolId)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const instruction =
    typeof body.instruction === 'string' ? body.instruction.trim().slice(0, MAX_INSTRUCTION) : '';
  if (!instruction) {
    return NextResponse.json({ error: '何を書くかを入力してください' }, { status: 400 });
  }

  // 作り直しのときだけ来る。★形が違うものはここで落とす
  const currentLines = Array.isArray(body.currentLines)
    ? body.currentLines
        .filter((l): l is string => typeof l === 'string' && l.length <= MAX_BLOCK_LENGTH)
        .slice(0, MAX_BLOCKS)
    : [];

  const empty: ComposeResponse = { blocks: [], blankCount: 0, degraded: false, disabled: false };

  // ★この教室でAIに送ってよいか。読み取り・整えると同じ栓（行が無ければOFF）
  const supabase = getPortalServiceClient();
  const { data: setting } = await supabase
    .from('school_ai_settings')
    .select('enabled')
    .eq('school_id', schoolId)
    .eq('feature_key', BULLETIN_AI_FEATURE_KEY)
    .maybeSingle();

  if (!setting?.enabled) {
    return NextResponse.json({ ...empty, disabled: true } satisfies ComposeResponse);
  }

  if (!isClaudeConfigured()) {
    return NextResponse.json({ ...empty, degraded: true } satisfies ComposeResponse);
  }

  try {
    const raw = await callClaudeJson<unknown>({
      // ★下書きは文章を組み立てるので smart を使う。整えるほうは fast で足りる
      model: CLAUDE_MODELS.smart,
      // 書式の決まりは毎回同じなのでキャッシュに載せる
      system: [{ text: composeSystemPrompt(), cache: true }],
      userText: composeUserText({ instruction, currentLines }),
      maxTokens: 2000,
    });
    const result = parseComposeResult(raw);
    if (result.blocks.length === 0) {
      // 読めなかった。★本文は触らせない
      return NextResponse.json({ ...empty, degraded: true } satisfies ComposeResponse);
    }
    return NextResponse.json({
      ...result,
      degraded: false,
      disabled: false,
    } satisfies ComposeResponse);
  } catch (e) {
    const reason = e instanceof ClaudeError ? e.reason : 'unavailable';
    console.error('[ai/compose] failed', reason, e);
    return NextResponse.json({ ...empty, degraded: true } satisfies ComposeResponse);
  }
}
