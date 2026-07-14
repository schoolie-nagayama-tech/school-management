import { NextResponse } from 'next/server';
import { getPortalContext } from '@/lib/mypage/supabase';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { unreadCountForReader } from '@/lib/mypage/chatService';
import type { PortalThreadSummary } from '@/types/chat';

export const dynamic = 'force-dynamic';

/**
 * 保護者チャット: 自分の紐づけ生徒ごとのスレッド概要一覧。
 *
 * 紐づけ生徒は portal クライアント（RLS: 在籍中の紐づけのみ）で取得し、各生徒の
 * スレッド・最終メッセージ・未読数は service role で解決する。スレッド未作成の生徒は
 * thread_id=null（初回送信で作られる）。
 */
export async function GET() {
  const ctx = await getPortalContext();
  if (!ctx) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  const accountId = ctx.claims.sub;

  // 紐づけ生徒（在籍中のみ・RLS越し）。
  const { data: linksRaw } = await ctx.client
    .from('portal_account_students')
    .select('student_id, students(id, last_name, first_name, grade)');
  const links = (linksRaw ?? []) as unknown as {
    student_id: string;
    students: { id: string; last_name: string; first_name: string; grade: number | null } | null;
  }[];
  const visible = links.filter((l) => l.students != null);

  const svc = getPortalServiceClient();
  const summaries: PortalThreadSummary[] = [];

  for (const l of visible) {
    const st = l.students!;
    // スレッド（既存のみ・ここでは作成しない）。
    const { data: thread } = await svc
      .from('chat_threads')
      .select('id')
      .eq('student_id', l.student_id)
      .maybeSingle();
    const threadId = (thread as { id: string } | null)?.id ?? null;

    let lastAt: string | null = null;
    let preview: string | null = null;
    let unread = 0;
    if (threadId) {
      const { data: lastMsg } = await svc
        .from('chat_messages')
        .select('body, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastMsg) {
        lastAt = (lastMsg as { created_at: string }).created_at;
        preview = (lastMsg as { body: string }).body.slice(0, 40);
      }
      unread = await unreadCountForReader(
        { threadId, readerKind: 'portal', readerId: accountId },
        svc
      );
    }

    summaries.push({
      student_id: l.student_id,
      student_name: `${st.last_name} ${st.first_name}`,
      grade: st.grade,
      thread_id: threadId,
      last_message_at: lastAt,
      last_message_preview: preview,
      unread_count: unread,
    });
  }

  return NextResponse.json({ threads: summaries });
}
