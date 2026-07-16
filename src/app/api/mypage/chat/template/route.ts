import { NextRequest, NextResponse } from 'next/server';
import { getPortalContext } from '@/lib/mypage/supabase';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import {
  verifyPortalLink,
  resolveThreadForStudent,
  ensureParticipant,
  insertMessage,
  markRead,
} from '@/lib/mypage/chatService';
import { buildTemplateBody, buildAckBody } from '@/lib/mypage/chatTemplates';
import { isTransferDeadlinePassed } from '@/lib/mypage/transferDeadline';
import { getPortalTransferQuota } from '@/lib/mypage/transferQuota';
import { dispatchNotification } from '@/lib/mypage/notify';
import type { ChatTemplateKind, ChatTemplatePayload, TransferCandidate } from '@/types/chat';

export const dynamic = 'force-dynamic';

const TEMPLATE_KINDS: ChatTemplateKind[] = ['absence', 'transfer_request', 'meeting_request'];

/**
 * 保護者チャット: テンプレ（構造化メッセージ）送信。
 *
 * body: { student_id, template_kind, payload }
 *
 * 正典 §7-2:
 *   - absence / transfer_request は「対象授業の前日21:00(JST)」が振替締切。
 *     サーバー側でも必ず締切を再検証（クライアント改ざん対策）:
 *       - transfer_request で締切超過 → 欠席にダウングレード（transferDowngraded=true）。
 *       - absence で wantsTransfer=true かつ締切超過 → wantsTransfer=false にダウングレード。
 *   - 投稿直後に system の受付返信を自動生成（締切判定を文面に反映）。
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
  const kind = body.template_kind;
  const rawPayload = (body.payload ?? {}) as Record<string, unknown>;

  if (typeof studentId !== 'string' || !studentId) {
    return NextResponse.json({ error: 'student_id が必要です' }, { status: 400 });
  }
  if (typeof kind !== 'string' || !TEMPLATE_KINDS.includes(kind as ChatTemplateKind)) {
    return NextResponse.json({ error: 'テンプレ種別が不正です' }, { status: 400 });
  }
  const templateKind = kind as ChatTemplateKind;

  // ── payload の正規化（型を絞る） ──
  const payload: ChatTemplatePayload = {
    lessonDate: typeof rawPayload.lessonDate === 'string' ? rawPayload.lessonDate : undefined,
    lessonSlot: typeof rawPayload.lessonSlot === 'string' ? rawPayload.lessonSlot : undefined,
    reason: typeof rawPayload.reason === 'string' ? rawPayload.reason : undefined,
    wantsTransfer: rawPayload.wantsTransfer === true,
    candidates: normalizeCandidates(rawPayload.candidates),
    preferredNote:
      typeof rawPayload.preferredNote === 'string' ? rawPayload.preferredNote : undefined,
  };

  // absence/transfer_request は対象授業日が必須。
  if ((templateKind === 'absence' || templateKind === 'transfer_request') && !payload.lessonDate) {
    return NextResponse.json({ error: '対象の授業日を指定してください' }, { status: 400 });
  }

  // ── 振替締切のサーバー再検証（JST） ──
  let deadlinePassed = false;
  if (payload.lessonDate && (templateKind === 'absence' || templateKind === 'transfer_request')) {
    deadlinePassed = isTransferDeadlinePassed(payload.lessonDate);
  }

  if (deadlinePassed) {
    if (templateKind === 'transfer_request') {
      // 振替希望そのものが締切超過 → 欠席にダウングレード（振替対象外）。
      payload.wantsTransfer = false;
      payload.transferDowngraded = true;
      payload.candidates = [];
    } else if (templateKind === 'absence' && payload.wantsTransfer) {
      // 欠席＋振替希望のうち振替だけを落とす（欠席は受理）。
      payload.wantsTransfer = false;
      payload.transferDowngraded = true;
      payload.candidates = [];
    }
  }

  // ── 認可（紐づけ検証）──
  // ★ 順序の意図: 下のクォータ再検証は service role で DB を引くので、
  //   「他人の生徒IDを投げて残り回数を推測される」ことが無いよう、必ず先に 403 で弾く。
  const svc = getPortalServiceClient();
  if (!(await verifyPortalLink(accountId, studentId, svc))) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  // ── 振替上限のサーバー再検証（§7-3）──
  // クライアント（AbsenceSheet）でも振替希望を無効化するが、サーバーが最終防衛線。
  // 締切ルールと同じ二重チェック方針で、上限到達なら欠席へダウングレードする。
  // 判定は getPortalTransferQuota に集約（フリー期間・教室の追加許可もそこで解決）。
  let quotaBlocked = false;
  const wantsTransferNow =
    !deadlinePassed &&
    (templateKind === 'transfer_request' || (templateKind === 'absence' && payload.wantsTransfer));
  if (wantsTransferNow && payload.lessonDate) {
    // 月の基準は「対象授業日」（今日ではない）。getPortalTransferQuota がその契約。
    const quota = await getPortalTransferQuota(studentId, payload.lessonDate);
    if (!quota.canRequestTransfer) {
      quotaBlocked = true;
      payload.wantsTransfer = false;
      payload.transferDowngraded = true;
      payload.transferBlockedByQuota = true;
      payload.candidates = [];
    }
  }

  // 締切内・上限内で振替を希望するなら第1希望は必須。
  // ★ ダウングレード後に評価する: 上限で振替が落ちた連絡を「第1希望が無い」で 400 にすると、
  //   保護者は欠席連絡すら送れなくなる（欠席は受理すべき）。
  const requiresCandidates =
    !deadlinePassed &&
    !quotaBlocked &&
    (templateKind === 'transfer_request' || (templateKind === 'absence' && payload.wantsTransfer));
  if (requiresCandidates && (!payload.candidates || payload.candidates.length === 0)) {
    return NextResponse.json({ error: '振替の第1希望（日付）を入力してください' }, { status: 400 });
  }

  // ── 面談予約URL（教室ごと）──
  // ★ 認可（verifyPortalLink）の後で引く: 生徒IDから教室の設定を引く経路なので、
  //   紐づけ検証を通っていない相手には一切引かせない（他の DB 参照と同じ順序方針）。
  // ★ 面談希望のときだけ引く（欠席・振替では使わない値のために毎回1クエリ増やさない）。
  let meetingBookingUrl: string | null = null;
  if (templateKind === 'meeting_request') {
    const { data: studentRow } = await svc
      .from('students')
      .select('school_id')
      .eq('id', studentId)
      .maybeSingle();
    if (studentRow?.school_id) {
      const { data: schoolRow } = await svc
        .from('schools')
        .select('meeting_booking_url')
        .eq('id', studentRow.school_id)
        .maybeSingle();
      meetingBookingUrl = schoolRow?.meeting_booking_url ?? null;
    }
  }

  const thread = await resolveThreadForStudent(studentId, null, svc);
  if (!thread) return NextResponse.json({ error: 'スレッドの用意に失敗しました' }, { status: 500 });
  await ensureParticipant(thread.id, accountId, svc);

  // ── (1) 保護者のテンプレメッセージ ──
  const templateMsg = await insertMessage(
    {
      threadId: thread.id,
      senderKind: 'portal',
      senderId: accountId,
      body: buildTemplateBody(templateKind, payload),
      templateKind,
      payload,
    },
    svc
  );
  if (!templateMsg) return NextResponse.json({ error: '送信に失敗しました' }, { status: 500 });

  // ── (2) 受付の自動返信（system）── 締切判定を文面に反映。
  const ackBody = buildAckBody(templateKind, payload, deadlinePassed, meetingBookingUrl);
  const ackMsg = await insertMessage(
    { threadId: thread.id, senderKind: 'system', senderId: null, body: ackBody },
    svc
  );

  // 保護者側の既読を進める（自分の送信＋直後の system 受付は既読扱い）。
  await markRead({ threadId: thread.id, readerKind: 'portal', readerId: accountId }, svc);

  // 通知（スタッフ宛）。非致命。
  void dispatchNotification({
    kind: 'chat_new_message',
    studentId,
    title: '保護者チャットにテンプレ連絡',
    body: buildTemplateBody(templateKind, payload),
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    message: templateMsg,
    ack: ackMsg,
    transferDowngraded: !!payload.transferDowngraded,
    // クライアントが「上限で落ちた」ことを区別して案内できるように分けて返す。
    transferBlockedByQuota: !!payload.transferBlockedByQuota,
    deadlinePassed,
  });
}

/** payload.candidates を [{date, slot}] に正規化（最大3・date必須）。 */
function normalizeCandidates(raw: unknown): TransferCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: TransferCandidate[] = [];
  for (const c of raw) {
    if (c && typeof c === 'object') {
      const date = (c as Record<string, unknown>).date;
      const slot = (c as Record<string, unknown>).slot;
      if (typeof date === 'string' && date) {
        out.push({ date, slot: typeof slot === 'string' ? slot : '' });
      }
    }
    if (out.length >= 3) break;
  }
  return out;
}
