import type { getPortalServiceClient } from '@/lib/mypage/serviceClient';

type ServiceClient = ReturnType<typeof getPortalServiceClient>;

/**
 * 保護者チャットの相手が、生徒本人か保護者かを引く。
 *
 * ★sender_kind='portal' だけでは区別できない（本人も保護者も 'portal' で入ってくる）ので、
 *   送信アカウントの portal_account_students.relation を引く
 *   （'self'=本人 / 'guardian'・'other'=保護者）。
 *
 * ★判定を1か所に置く。「保護者との連絡」AIは、画面では欄を出すか決めるのに
 *   （/api/admin/portal-chat/messages）、サーバーでは送ってよいかを決めるのに
 *   （/api/ai/message/compose）同じ判定を使う。別々に書くと片方だけ条件がずれ、
 *   画面には欄が出るのに押すと「使えません」と返る、が起きる。
 *
 * @returns relation。送信アカウントが無い・紐付けが見つからないときは null
 */
export async function lookupPortalSenderRelation(
  svc: ServiceClient,
  params: { accountId: string | null; studentId: string }
): Promise<string | null> {
  if (!params.accountId) return null;
  const { data } = await svc
    .from('portal_account_students')
    .select('relation')
    .eq('account_id', params.accountId)
    .eq('student_id', params.studentId)
    .maybeSingle();
  return (data as { relation?: string } | null)?.relation ?? null;
}
