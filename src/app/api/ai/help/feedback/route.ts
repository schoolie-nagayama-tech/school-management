import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';

export const dynamic = 'force-dynamic';

/**
 * AIヘルプの「役に立った / 立たなかった」を記録する。
 *
 * ★立たなかった側が本命。答えは出したが的外れだった質問は、
 *   FAQを書き足す材料としては「答えられなかった質問」と同じ価値がある。
 *
 * 自分が出した質問の行だけ更新できる（user_id で縛る）。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  let body: { logId?: unknown; helpful?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const logId = typeof body.logId === 'string' ? body.logId : '';
  if (!UUID_RE.test(logId)) {
    return NextResponse.json({ error: 'IDが不正です' }, { status: 400 });
  }
  if (typeof body.helpful !== 'boolean') {
    return NextResponse.json({ error: '評価が不正です' }, { status: 400 });
  }

  try {
    const supabase = getPortalServiceClient();
    // ★自分の質問の行だけ。他人の記録は触らせない
    const { error } = await supabase
      .from('help_questions')
      .update({ helpful: body.helpful })
      .eq('id', logId)
      .eq('user_id', auth.userId);
    if (error) {
      console.error('[ai/help/feedback] 更新に失敗', error.message);
      return NextResponse.json({ error: '記録できませんでした' }, { status: 500 });
    }
  } catch (e) {
    console.error('[ai/help/feedback] 更新に失敗', e);
    return NextResponse.json({ error: '記録できませんでした' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
