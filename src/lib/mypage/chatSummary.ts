import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { unreadCountForReader } from './chatService';
import type { PortalThreadSummary } from '@/types/chat';

/**
 * 保護者チャット: 自分の紐づけ生徒ごとのスレッド概要一覧。
 *
 * ★ なぜ /api/mypage/chat/threads/route.ts から切り出したか:
 *   ダッシュボード（app/mypage/page.tsx）の「教室からの連絡」セクションも
 *   同じ「生徒ごとの未読数・最新プレビュー」を使う。ルートにベタ書きのままだと
 *   ダッシュボードから fetch 経由でもう一度叩く（スピナーが増える）か、
 *   ロジックをコピペするかの二択になるため、サーバーコンポーネントから直接
 *   呼べる関数として共有し、ルートは薄いラッパーにする。
 *
 * 紐づけ生徒は portal クライアント（RLS: 在籍中の紐づけのみ）で取得し、各生徒の
 * スレッド・最終メッセージ・未読数は service role で解決する。スレッド未作成の生徒は
 * thread_id=null（初回送信で作られる）。
 *
 * @param client portal クライアント（RLS越し・紐づけ生徒の解決に使う）
 * @param svc    service role クライアント（chat_* テーブルは portal ロールに
 *               SELECT ポリシーが無いため、これで読む。呼び出し元と共有すること
 *               — ここで毎回 getPortalServiceClient() し直すと接続が無駄に増える）
 * @param accountId ポータルアカウントID（自分にとっての未読件数の起点）
 */
export async function getPortalChatSummaries(
  client: SupabaseClient,
  svc: SupabaseClient,
  accountId: string
): Promise<PortalThreadSummary[]> {
  // 紐づけ生徒（在籍中のみ・RLS越し）。
  const { data: linksRaw } = await client
    .from('portal_account_students')
    .select('student_id, students(id, last_name, first_name, grade)');
  const links = (linksRaw ?? []) as unknown as {
    student_id: string;
    students: { id: string; last_name: string; first_name: string; grade: number | null } | null;
  }[];
  const visible = links.filter((l) => l.students != null);

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

  return summaries;
}
