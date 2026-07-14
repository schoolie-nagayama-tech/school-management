import { NextRequest, NextResponse } from 'next/server';
import { requireManager, getApiAuth } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { insertMessage, listMessages, markRead } from '@/lib/mypage/chatService';
import { dispatchNotification } from '@/lib/mypage/notify';

export const dynamic = 'force-dynamic';

/** スレッドがスタッフの教室スコープ内か検証し、school_id/student_id を返す。 */
async function loadThreadInScope(
  svc: ReturnType<typeof getPortalServiceClient>,
  threadId: string,
  schoolIds: string[]
): Promise<{ school_id: string; student_id: string } | null> {
  const { data } = await svc
    .from('chat_threads')
    .select('school_id, student_id')
    .eq('id', threadId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { school_id: string; student_id: string };
  if (!schoolIds.includes(row.school_id)) return null;
  return row;
}

/**
 * スタッフ側: スレッドのメッセージ取得 / 返信。
 *
 * GET  ?thread_id= → メッセージ一覧（開いた時点でスタッフ既読）。
 * POST { thread_id, body } → スタッフ返信（sender_kind='staff', sender_id=userId）。
 * すべて requireManager ＋ 教室スコープ検証（service role 経由）。
 */
export async function GET(request: NextRequest) {
  const denied = await requireManager(request);
  if (denied) return denied;
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const threadId = request.nextUrl.searchParams.get('thread_id');
  if (!threadId) return NextResponse.json({ error: 'thread_id が必要です' }, { status: 400 });

  const svc = getPortalServiceClient();
  const thread = await loadThreadInScope(svc, threadId, auth.schoolIds);
  if (!thread) return NextResponse.json({ error: '権限がありません' }, { status: 403 });

  const messages = await listMessages(threadId, svc);
  await markRead({ threadId, readerKind: 'staff', readerId: auth.userId }, svc);
  return NextResponse.json({ thread_id: threadId, student_id: thread.student_id, messages });
}

export async function POST(request: NextRequest) {
  const denied = await requireManager(request);
  if (denied) return denied;
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }
  const threadId = body.thread_id;
  const text = body.body;
  if (typeof threadId !== 'string' || !threadId) {
    return NextResponse.json({ error: 'thread_id が必要です' }, { status: 400 });
  }
  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'メッセージを入力してください' }, { status: 400 });
  }

  const svc = getPortalServiceClient();
  const thread = await loadThreadInScope(svc, threadId, auth.schoolIds);
  if (!thread) return NextResponse.json({ error: '権限がありません' }, { status: 403 });

  const msg = await insertMessage(
    { threadId, senderKind: 'staff', senderId: auth.userId, body: text.trim() },
    svc
  );
  if (!msg) return NextResponse.json({ error: '送信に失敗しました' }, { status: 500 });

  // スタッフ返信で自分側の既読を進める。
  await markRead({ threadId, readerKind: 'staff', readerId: auth.userId }, svc);

  // 保護者宛の新着通知（メール等）。非致命。
  void dispatchNotification({
    kind: 'chat_new_message',
    studentId: thread.student_id,
    title: '教室から新着メッセージ',
    body: text.trim(),
  }).catch(() => {});

  return NextResponse.json({ ok: true, message: msg });
}
