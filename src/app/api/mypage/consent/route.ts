import { NextRequest, NextResponse } from 'next/server';
import { getPortalContext } from '@/lib/mypage/supabase';
import { recordConsent } from '@/lib/mypage/legal';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * 再同意の記録（P3-L4）。
 *
 * 文書の版が上がると hasCurrentConsent() が false になり、ダッシュボードが
 * /mypage/consent へリダイレクトする。その画面の「同意して続ける」がここを叩く。
 *
 * body: { agreed: true }
 *
 * 招待受諾（/api/mypage/invite/accept）と違い、こちらは既にアカウントがある
 * 前提なのでセッション必須。account_id は body ではなくセッションの sub から取る
 * （他人のアカウントの同意を代わりに記録させないため）。
 */
export async function POST(request: NextRequest) {
  const ctx = await getPortalContext();
  if (!ctx) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/mypage/consent',
    });
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  if (body.agreed !== true) {
    return NextResponse.json(
      { error: 'プライバシーポリシーと利用規約への同意が必要です' },
      { status: 400 }
    );
  }

  // 同意ログは証跡そのものなので、書けなければ成功扱いにしない（500 を返す）。
  try {
    await recordConsent(ctx.claims.sub);
  } catch (e) {
    captureApiError(e, {
      route: 'POST /api/mypage/consent',
    });
    console.error('[mypage/consent] 同意ログの記録に失敗:', (e as Error).message);
    return NextResponse.json({ error: '同意の記録に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
