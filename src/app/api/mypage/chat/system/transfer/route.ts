import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import {
  resolveThreadForStudent,
  ensureParticipant,
  insertMessage,
  portalAccountIdsForStudent,
} from '@/lib/mypage/chatService';
import { buildTransferConfirmedBody } from '@/lib/mypage/chatTemplates';
import { dispatchNotification } from '@/lib/mypage/notify';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * 座席表からの振替確定 → 保護者スレッドへ system メッセージ自動投稿（＋メール）。
 *
 * 正典 §7-2「振替確定の座席表からの自動発信」。
 *   completeHeldTransfer 成功後にクライアントから fire-and-forget で叩かれる（requireManager）。
 *
 * body: { transferNotificationId } または { toEntryId }（どちらかで振替を特定）。
 *
 * 挙動:
 *   - service role で該当生徒→紐づけ保護者アカウント→スレッドを解決し system メッセージ投稿。
 *   - 紐づけ保護者が居なければ no-op で 200（クローズド期間の大半はポータル未登録）。
 *   - 冪等: 同じ振替（transfer_notifications.id または to_entry_id）で既に system メッセージを
 *     投げていれば skip（二重投稿防止）。冪等キーは payload.transfer_key に持たせて照合する。
 *   - 非致命: どんな失敗でも振替登録自体は成立済みなので、ここでのエラーは 200/skip に丸める。
 */
export async function POST(request: NextRequest) {
  const denied = await requireManager(request);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/mypage/chat/system/transfer',
    });
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const transferNotificationId =
    typeof body.transferNotificationId === 'string' ? body.transferNotificationId : null;
  const toEntryId = typeof body.toEntryId === 'string' ? body.toEntryId : null;
  if (!transferNotificationId && !toEntryId) {
    return NextResponse.json(
      { error: 'transferNotificationId か toEntryId が必要です' },
      { status: 400 }
    );
  }

  const svc = getPortalServiceClient();

  // ── 振替情報の解決（通知レコード優先、無ければ schedule_entries から） ──
  let studentId: string | null = null;
  let toDate: string | null = null;
  let toSlotLabel: string | null = null;
  let subjectIds: string[] = [];
  // 冪等キー: 通知レコードIDがあればそれを、無ければ to_entry_id を使う。
  const idemKey = transferNotificationId ? `tn:${transferNotificationId}` : `entry:${toEntryId}`;

  if (transferNotificationId) {
    const { data: tn } = await svc
      .from('transfer_notifications')
      .select('student_id, to_date, to_time_slot_label, to_entry_id')
      .eq('id', transferNotificationId)
      .maybeSingle();
    if (tn) {
      studentId = (tn as { student_id: string }).student_id;
      toDate = (tn as { to_date: string }).to_date;
      toSlotLabel = (tn as { to_time_slot_label: string | null }).to_time_slot_label;
      // 科目は通知レコードに無いので、to_entry から拾う。
      const tnToEntry = (tn as { to_entry_id: string | null }).to_entry_id;
      if (tnToEntry) subjectIds = await fetchSubjectIds(svc, tnToEntry);
    }
  }
  if (!studentId && toEntryId) {
    const { data: entry } = await svc
      .from('schedule_entries')
      .select('student_id, entry_date, time_slot_id, subject_ids')
      .eq('id', toEntryId)
      .maybeSingle();
    if (entry) {
      studentId = (entry as { student_id: string }).student_id;
      toDate = (entry as { entry_date: string }).entry_date;
      subjectIds = ((entry as { subject_ids: string[] | null }).subject_ids ?? []) as string[];
      const slotId = (entry as { time_slot_id: string }).time_slot_id;
      toSlotLabel = await fetchSlotLabel(svc, slotId);
    }
  }

  if (!studentId || !toDate) {
    // 情報が引けない＝データ不整合。非致命なので no-op で返す。
    return NextResponse.json({ ok: true, skipped: true, reason: 'not-resolved' });
  }

  // ── 紐づけ保護者の解決。居なければ no-op。 ──
  const accountIds = await portalAccountIdsForStudent(studentId, svc);
  if (accountIds.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no-portal-account' });
  }

  // ── スレッド解決（作成スタッフは記録しない=null） ──
  const thread = await resolveThreadForStudent(studentId, null, svc);
  if (!thread) return NextResponse.json({ ok: true, skipped: true, reason: 'no-thread' });

  // 紐づけ保護者を参加者に（初回投稿時に確実に見えるように）。
  for (const acc of accountIds) await ensureParticipant(thread.id, acc, svc);

  // ── 冪等チェック: 同じ振替で既に system メッセージを投げていないか ──
  const { data: dup } = await svc
    .from('chat_messages')
    .select('id')
    .eq('thread_id', thread.id)
    .eq('sender_kind', 'system')
    .contains('payload', { transfer_key: idemKey })
    .maybeSingle();
  if (dup) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'already-sent' });
  }

  // 科目名を解決。
  const subjectNames = subjectIds.length > 0 ? await fetchSubjectNames(svc, subjectIds) : [];

  const messageBody = buildTransferConfirmedBody({
    toDate,
    toSlotLabel,
    subjectNames,
  });

  const msg = await insertMessage(
    {
      threadId: thread.id,
      senderKind: 'system',
      senderId: null,
      body: messageBody,
      // 冪等キーを payload に埋めて二重投稿を防ぐ。
      payload: { transfer_key: idemKey },
    },
    svc
  );
  if (!msg) return NextResponse.json({ ok: true, skipped: true, reason: 'insert-failed' });

  // メール通知（宛先未解決なら no-op）。非致命。
  void dispatchNotification({
    kind: 'system_message',
    // 振替確定の連絡は保護者宛＝LINEプッシュの対象（通知マトリクス: 予定変更）。
    audience: 'guardian',
    studentId,
    title: '振替日が決まりました',
    body: messageBody,
  }).catch(() => {});

  return NextResponse.json({ ok: true, skipped: false, message_id: msg.id });
}

/** schedule_entries から subject_ids を拾う。 */
async function fetchSubjectIds(svc: ReturnType<typeof getPortalServiceClient>, entryId: string) {
  const { data } = await svc
    .from('schedule_entries')
    .select('subject_ids')
    .eq('id', entryId)
    .maybeSingle();
  return ((data as { subject_ids: string[] | null } | null)?.subject_ids ?? []) as string[];
}

/** time_slot の '17:00〜18:30' 形式ラベルを作る。 */
async function fetchSlotLabel(
  svc: ReturnType<typeof getPortalServiceClient>,
  slotId: string
): Promise<string | null> {
  const { data } = await svc
    .from('schedule_time_slots')
    .select('start_time, end_time')
    .eq('id', slotId)
    .maybeSingle();
  if (!data) return null;
  const s = (data as { start_time: string }).start_time?.slice(0, 5);
  const e = (data as { end_time: string }).end_time?.slice(0, 5);
  return s && e ? `${s}〜${e}` : null;
}

/** subject_ids → 科目名配列。 */
async function fetchSubjectNames(
  svc: ReturnType<typeof getPortalServiceClient>,
  subjectIds: string[]
): Promise<string[]> {
  const { data } = await svc.from('subjects').select('id, name').in('id', subjectIds);
  return (data ?? []).map((r: { name: string }) => r.name);
}
