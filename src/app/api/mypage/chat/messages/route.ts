import { NextRequest, NextResponse } from 'next/server';
import { getPortalContext } from '@/lib/mypage/supabase';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import {
  verifyPortalLink,
  resolveThreadForStudent,
  ensureParticipant,
  insertMessage,
  listMessages,
  markRead,
} from '@/lib/mypage/chatService';
import { dispatchNotification } from '@/lib/mypage/notify';

export const dynamic = 'force-dynamic';

/**
 * 保護者チャット: メッセージ一覧取得 / 自由テキスト送信。
 *
 * GET  ?student_id=  → その生徒スレッドのメッセージ（自分が紐づく生徒のみ）。
 * POST { student_id, body } → 保護者発言を投稿（スレッド無ければ自動作成＋自分を参加者に）。
 *
 * 認可: ポータルJWTの sub が対象生徒に紐づくことを verifyPortalLink で必ず確認する
 *   （URLの student_id 改ざん対策）。書き込みは service role。
 */
export async function GET(request: NextRequest) {
  const ctx = await getPortalContext();
  if (!ctx) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const accountId = ctx.claims.sub;

  const studentId = request.nextUrl.searchParams.get('student_id');
  if (!studentId) return NextResponse.json({ error: 'student_id が必要です' }, { status: 400 });

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
  if (!threadId) return NextResponse.json({ thread_id: null, messages: [] });

  const messages = await listMessages(threadId, svc);
  // 開いた時点で保護者既読にする（未読バッジのクリア）。
  await markRead({ threadId, readerKind: 'portal', readerId: accountId }, svc);

  return NextResponse.json({ thread_id: threadId, messages });
}

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
  const text = body.body;
  if (typeof studentId !== 'string' || !studentId) {
    return NextResponse.json({ error: 'student_id が必要です' }, { status: 400 });
  }
  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'メッセージを入力してください' }, { status: 400 });
  }

  const svc = getPortalServiceClient();
  if (!(await verifyPortalLink(accountId, studentId, svc))) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  // スレッド解決（初回は自動作成）＋自分を参加者に。
  const thread = await resolveThreadForStudent(studentId, null, svc);
  if (!thread) return NextResponse.json({ error: 'スレッドの用意に失敗しました' }, { status: 500 });
  await ensureParticipant(thread.id, accountId, svc);

  const msg = await insertMessage(
    { threadId: thread.id, senderKind: 'portal', senderId: accountId, body: text.trim() },
    svc
  );
  if (!msg) return NextResponse.json({ error: '送信に失敗しました' }, { status: 500 });

  // 保護者発言の既読を自分側で進める（自分の発言は未読に数えない実装だが整合のため）。
  await markRead({ threadId: thread.id, readerKind: 'portal', readerId: accountId }, svc);

  // 通知（スタッフ宛のメール等）。非致命なので失敗しても送信自体は成功扱い。
  // 宛先は教室スタッフ側の運用に依存するため、ここでは studentId 起点の暫定解決に委ねる。
  void dispatchNotification({
    kind: 'chat_new_message',
    studentId,
    title: '保護者チャットに新着メッセージ',
    body: text.trim(),
  }).catch(() => {});

  return NextResponse.json({ ok: true, message: msg });
}
