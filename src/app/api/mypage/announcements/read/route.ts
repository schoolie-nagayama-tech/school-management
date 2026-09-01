import { NextRequest, NextResponse } from 'next/server';
import { getPortalContext } from '@/lib/mypage/supabase';
import { markPortalAnnouncementRead } from '@/lib/mypage/announcements';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * お知らせ既読化。body: { post_id }。
 * 可視性は portal RLS が担保するため、ここでは自分のアカウントで既読行を作るだけ。
 */
export async function POST(request: NextRequest) {
  const ctx = await getPortalContext();
  if (!ctx) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/mypage/announcements/read',
      userId: ctx.claims.sub,
    });
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }
  const postId = body.post_id;
  if (typeof postId !== 'string' || !postId) {
    return NextResponse.json({ error: 'post_id が必要です' }, { status: 400 });
  }

  await markPortalAnnouncementRead(ctx.claims.sub, postId);
  return NextResponse.json({ ok: true });
}
