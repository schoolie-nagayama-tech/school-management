import { NextRequest, NextResponse } from 'next/server';
import { requireManager, getApiAuth } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { unreadCountForReader } from '@/lib/mypage/chatService';

export const dynamic = 'force-dynamic';

/**
 * スタッフ受信箱: 生徒ごとのチャットスレッド一覧（requireManager・教室スコープ）。
 *
 * chat_* は portal ロール以外に SELECT ポリシーを作らない設計のため、スタッフ閲覧は
 * service role 経由のこの API で行う（教室スコープは auth.schoolIds で絞る）。
 *
 * GET ?school_id= → 指定教室（未指定なら自分の全スコープ）のスレッドを新着順に返す。
 */
export async function GET(request: NextRequest) {
  const denied = await requireManager(request);
  if (denied) return denied;
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const svc = getPortalServiceClient();
  const schoolIdParam = request.nextUrl.searchParams.get('school_id');

  // 対象教室 = 指定があればスコープ内に限定、無ければ自分の全スコープ。
  let scopeSchoolIds = auth.schoolIds;
  if (schoolIdParam) {
    if (!auth.schoolIds.includes(schoolIdParam)) {
      return NextResponse.json({ error: '教室スコープ外です' }, { status: 403 });
    }
    scopeSchoolIds = [schoolIdParam];
  }
  if (scopeSchoolIds.length === 0) return NextResponse.json({ threads: [] });

  const { data: threads, error } = await svc
    .from('chat_threads')
    .select('id, school_id, student_id, created_at, students(last_name, first_name, grade)')
    .in('school_id', scopeSchoolIds)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[admin/portal-chat/threads] 取得に失敗:', error.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }

  const rows = (threads ?? []) as unknown as {
    id: string;
    school_id: string;
    student_id: string;
    created_at: string;
    students: { last_name: string; first_name: string; grade: number | null } | null;
  }[];

  const result = [];
  for (const t of rows) {
    const { data: lastMsg } = await svc
      .from('chat_messages')
      .select('body, created_at, sender_kind')
      .eq('thread_id', t.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const unread = await unreadCountForReader(
      { threadId: t.id, readerKind: 'staff', readerId: auth.userId },
      svc
    );
    result.push({
      thread_id: t.id,
      school_id: t.school_id,
      student_id: t.student_id,
      student_name: t.students ? `${t.students.last_name} ${t.students.first_name}` : '—',
      grade: t.students?.grade ?? null,
      last_message_at: (lastMsg as { created_at: string } | null)?.created_at ?? null,
      last_message_preview: (lastMsg as { body: string } | null)?.body?.slice(0, 40) ?? null,
      unread_count: unread,
    });
  }

  // 未読があるスレッドを上に、その後は新着順。
  result.sort((a, b) => {
    if ((b.unread_count > 0 ? 1 : 0) !== (a.unread_count > 0 ? 1 : 0)) {
      return (b.unread_count > 0 ? 1 : 0) - (a.unread_count > 0 ? 1 : 0);
    }
    return (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '');
  });

  return NextResponse.json({ threads: result });
}
