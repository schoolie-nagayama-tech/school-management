import { fetchWithAuth } from '@/lib/api/auth';
import type { StudentChatDigest } from '@/lib/mypage/chatDigest';

/**
 * 生徒1人分の保護者との連絡の要旨（新しい順・既定5件）。生徒ハブ用。
 *
 * ★/api/admin/** は requireManager を通るので、素の fetch ではなく fetchWithAuth で叩く（401 回避）。
 * 失敗は例外にする。呼び出し側が「連絡はまだありません」と取り違えないため。
 */
export async function getStudentParentMessages(
  studentId: string,
  limit = 5
): Promise<StudentChatDigest> {
  const qs = new URLSearchParams({ student_id: studentId, limit: String(limit) });
  const res = await fetchWithAuth(`/api/admin/portal-chat/student?${qs.toString()}`);
  if (!res.ok) throw new Error(`保護者との連絡の取得に失敗しました (${res.status})`);
  return (await res.json()) as StudentChatDigest;
}
