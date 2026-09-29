import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { callClaudeJson, isClaudeConfigured, CLAUDE_MODELS, ClaudeError } from '@/lib/ai/claude';
import { SCORE_SHEET_FEATURE_KEY } from '@/lib/ai/features';
import { readSystemPrompt, readUserText, SCORE_SHEET_IMAGE_LIMIT } from '@/lib/ai/scoreSheet';
import { parseMockSheet } from '@/lib/scoreSheet/mockSheet';
import type { MockSheet } from '@/lib/scoreSheet/types';

export const dynamic = 'force-dynamic';
// ★帳票の画像を最上位のモデルで読むので時間がかかる（実測で数十秒）。既定で切られないよう明示する
export const maxDuration = 120;

/**
 * 模試の個人帳票を読み取る（教室長以上）。
 * 正典: docs/score-sheet-plan-draft.md §4.2
 *
 * ★受け取るのは、画面で1・2ページ目だけを切り出した画像。PDF そのものは受け取らない
 *   （答案の画像を送らない・Vercel の本文の上限4.5MBに収める）。
 * ★読み取った結果は保存しない（決定15）。返すだけで、下書きを組むのも保存するのも画面。
 * ★AI には書き写させるだけ。検算とコマの判断は lib/scoreSheet 側（システム）でする。
 */

interface ReadResponse {
  sheet: MockSheet | null;
  degraded: boolean;
  disabled: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 画像1枚の base64 の上限。画面で長辺1568px の JPEG にしているので、普通は300KB前後
const MAX_IMAGE_B64 = 1_500_000;

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: { schoolId?: unknown; images?: unknown };
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

  const images = Array.isArray(body.images)
    ? body.images
        .map((v) => v as { mediaType?: unknown; base64?: unknown })
        .filter(
          (v): v is { mediaType: 'image/jpeg' | 'image/png'; base64: string } =>
            (v.mediaType === 'image/jpeg' || v.mediaType === 'image/png') &&
            typeof v.base64 === 'string' &&
            v.base64.length > 0 &&
            v.base64.length <= MAX_IMAGE_B64
        )
        .slice(0, SCORE_SHEET_IMAGE_LIMIT)
    : [];
  if (images.length === 0) {
    return NextResponse.json({ error: '画像がありません' }, { status: 400 });
  }

  const empty: ReadResponse = { sheet: null, degraded: false, disabled: false };
  const supabase = getPortalServiceClient();

  // ★この教室で帳票の画像をAIに送ってよいか。ほかの機能とは別のキー（既定OFF）
  const { data: setting } = await supabase
    .from('school_ai_settings')
    .select('enabled')
    .eq('school_id', schoolId)
    .eq('feature_key', SCORE_SHEET_FEATURE_KEY)
    .maybeSingle();
  if (!setting?.enabled) {
    return NextResponse.json({ ...empty, disabled: true } satisfies ReadResponse);
  }
  if (!isClaudeConfigured()) {
    return NextResponse.json({ ...empty, degraded: true } satisfies ReadResponse);
  }

  try {
    const raw = await callClaudeJson<Record<string, unknown>>({
      // ★「まずOpusで。Opusで使えなければ安いモデルを試す意味がない」（2026-09-28 決定2）
      model: CLAUDE_MODELS.best,
      system: [{ text: readSystemPrompt(), cache: true }],
      userText: readUserText(),
      images: images.map((i) => ({ mediaType: i.mediaType, base64: i.base64 })),
      maxTokens: 8000,
      effort: 'medium',
    });
    // 学年は帳票の「3年」を、システムの学年（中1=7）に直す。中学の帳票なので +6
    const inSchool = typeof raw?.grade_in_school === 'number' ? raw.grade_in_school : null;
    const sheet = parseMockSheet(
      raw
        ? {
            ...raw,
            grade: inSchool != null && inSchool >= 1 && inSchool <= 3 ? inSchool + 6 : null,
          }
        : null
    );
    if (!sheet) return NextResponse.json({ ...empty, degraded: true } satisfies ReadResponse);
    return NextResponse.json({ sheet, degraded: false, disabled: false } satisfies ReadResponse);
  } catch (e) {
    const reason = e instanceof ClaudeError ? e.reason : 'unavailable';
    console.error('[ai/score-sheet/read] failed', reason);
    return NextResponse.json({ ...empty, degraded: true } satisfies ReadResponse);
  }
}
