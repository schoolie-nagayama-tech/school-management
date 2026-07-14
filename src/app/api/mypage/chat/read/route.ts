import { NextRequest, NextResponse } from 'next/server';
import { getPortalContext } from '@/lib/mypage/supabase';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { verifyPortalLink, markRead } from '@/lib/mypage/chatService';

export const dynamic = 'force-dynamic';

/**
 * 保護者チャット: 既読化。
 * body: { student_id } → その生徒スレッドを保護者既読にする。
 */
export async function POST(request: NextRequest) {
  const ctx = await getPortalContext();
  if (!ctx) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const accountId = ctx.claims.sub;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }
  const studentId = body.student_id;
  if (typeof studentId !== 'string' || !studentId) {
    return NextResponse.json({ error: 'student_id が必要です' }, { status: 400 });
  }

  const svc = getPortalServiceClient();
  if (!(await verifyPortalLink(accountId, studentId, svc))) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const { data: thread } = await svc
    .from('chat_threads')
    .select('id')
    .eq('student_id', studentId)
    .maybeSingle();
  const threadId = (thread as { id: string } | null)?.id ?? null;
  if (threadId) {
    await markRead({ threadId, readerKind: 'portal', readerId: accountId }, svc);
  }
  return NextResponse.json({ ok: true });
}
