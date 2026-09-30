import { NextRequest, NextResponse } from 'next/server';
import { requireManager, getApiAuth } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { listRecentMessages } from '@/lib/mypage/chatService';
import { buildStudentChatDigest } from '@/lib/mypage/chatDigest';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

/**
 * スタッフ側: 生徒1人分の保護者との連絡の要旨（生徒ハブ用）。requireManager・教室スコープ。
 *
 * GET ?student_id=&limit= → { thread_id, items(新しい順), awaiting_reply }
 *
 * ★読み方は受信箱（threads / messages ルート）と同じにそろえる: chat_* は portal ロール以外に
 *   SELECT ポリシーが無いので、requireManager を通したうえで service role で読み、
 *   thread.school_id ∈ auth.schoolIds で教室スコープを絞る。
 * ★messages ルートの GET は開いた時点でスタッフ既読を進める。ハブで要旨を見ただけで既読にすると
 *   受信箱の未読印が消えて返信漏れにつながるので、ここは既読を触らない別ルートにしている。
 */
export async function GET(request: NextRequest) {
  const denied = await requireManager(request);
  if (denied) return denied;
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const studentId = request.nextUrl.searchParams.get('student_id');
  if (!studentId) return NextResponse.json({ error: 'student_id が必要です' }, { status: 400 });
  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit =
    Number.isInteger(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const svc = getPortalServiceClient();
  // 生徒ごと1スレッド（student_id unique）なので maybeSingle で引ける。
  const { data: thread, error } = await svc
    .from('chat_threads')
    .select('id, school_id')
    .eq('student_id', studentId)
    .maybeSingle();
  if (error) {
    console.error('[admin/portal-chat/student] スレッド取得に失敗:', error.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }
  // スレッドがまだ無い = 連絡が1件も無い。スレッドが無ければ中身も無いので、スコープ判定は不要。
  if (!thread) return NextResponse.json(buildStudentChatDigest(null, [], limit));

  const row = thread as { id: string; school_id: string };
  if (!auth.schoolIds.includes(row.school_id)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const messages = await listRecentMessages(row.id, limit, svc);
  if (messages === null) {
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }
  return NextResponse.json(buildStudentChatDigest(row.id, messages, limit));
}
