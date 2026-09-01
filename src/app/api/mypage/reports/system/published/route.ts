import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { portalAccountIdsForStudent } from '@/lib/mypage/chatService';
import { dispatchNotification } from '@/lib/mypage/notify';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * 報告書の承認（＝公開）→ 保護者へ通知（画面内＋メール）。§7-4「通知」。
 *
 * POST /api/mypage/reports/system/published  body: { reportId }
 *
 * approveClassReport 成功後にクライアントから fire-and-forget で叩かれる（requireManager）。
 * Stage2 の振替自動発信（/api/mypage/chat/system/transfer）と同じ作法。
 *
 * 挙動:
 *   - 承認済み（status='approved'）でなければ no-op。「公開＝承認」なので、承認されて
 *     いないものの通知は絶対に出さない（保護者に未公開の存在を知らせない）。
 *   - 紐づけ保護者が居なければ no-op で 200（クローズド期間の大半はポータル未登録）。
 *   - 冪等: portal_report_notifications の PK insert が冪等キー（下記）。
 *   - 非致命: どんな失敗でも承認自体は成立済みなので、エラーは 200/skip に丸める。
 *
 * ★ 通知内容に報告書の中身を載せない:
 *   メールは経路上の安全性を制御できないため「新しい報告書が公開されました」だけを伝え、
 *   中身はポータルにログインして読んでもらう（成績はセンシティブな個人情報）。
 */
export async function POST(request: NextRequest) {
  const denied = await requireManager(request);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/mypage/reports/system/published',
    });
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const reportId = typeof body.reportId === 'string' ? body.reportId : null;
  if (!reportId) {
    return NextResponse.json({ error: 'reportId が必要です' }, { status: 400 });
  }

  const svc = getPortalServiceClient();

  // ── 報告書の解決。承認済みでなければ通知しない（公開ゲートの二重確認）。 ──
  const { data: report } = await svc
    .from('class_reports')
    .select('id, student_id, lesson_date, status, school_id')
    .eq('id', reportId)
    .maybeSingle();

  if (!report) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'not-found' });
  }
  const r = report as {
    student_id: string;
    lesson_date: string;
    status: string;
    school_id: string;
  };
  if (r.status !== 'approved') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'not-approved' });
  }

  // ── 紐づけ保護者の解決。居なければ no-op。 ──
  const accountIds = await portalAccountIdsForStudent(r.student_id, svc);
  if (accountIds.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no-portal-account' });
  }

  // ── 冪等ガード（★チェックと記録が1文で原子的） ──
  //   portal_report_notifications.report_id は PK。この insert が成功すること自体が
  //   「今回はじめて通知する」ことの証明になる（＝PK を冪等キーとして使う）。
  //   既に通知済み（承認の二度押し・差し戻し→再承認・リトライ）なら一意制約違反
  //   (23505) になるので skip。
  //   ★「読んでから書く」(select して無ければ insert) にしない理由:
  //     承認ボタンの二度押しで2リクエストが並走すると、両方が select で「無い」を見て
  //     両方が送ってしまう。insert の成否で判定すれば DB が直列化してくれるので、
  //     並走しても必ず片方だけが通る。
  //   送信前に記録するのは、二重送信（保護者に同じメールが複数届く）の方が
  //   送信漏れより体験上の害が大きいため。
  const { data: claimed, error: claimErr } = await svc
    .from('portal_report_notifications')
    .insert({ report_id: reportId })
    .select('report_id');

  if (claimErr) {
    // 一意制約違反＝既に通知済み。それ以外の障害も通知は非致命なので skip に丸める。
    return NextResponse.json({ ok: true, skipped: true, reason: 'already-sent' });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'already-sent' });
  }

  // ── 教室名（差出人表示用） ──
  const { data: school } = await svc
    .from('schools')
    .select('name')
    .eq('id', r.school_id)
    .maybeSingle();
  const schoolName = (school as { name: string } | null)?.name ?? 'スクールIE';

  // ── 生徒名（本文用） ──
  const { data: student } = await svc
    .from('students')
    .select('last_name, first_name')
    .eq('id', r.student_id)
    .maybeSingle();
  const s = student as { last_name: string; first_name: string } | null;
  const studentName = s ? `${s.last_name} ${s.first_name}` : 'お子さま';

  const lessonLabel = formatLessonDate(r.lesson_date);
  const results = await dispatchNotification({
    kind: 'report_published',
    // 保護者宛＝LINEプッシュの対象（通知マトリクス: 報告書公開は毎回push）。
    audience: 'guardian',
    studentId: r.student_id,
    // 件名・LINE本文の冒頭に教室名は入れない（2026-08-07 決定）。
    // 受け取る保護者にとって発信元は自分の子が通う教室に決まっており（宛先を
    // 生徒から逆引きしているため）、名乗る必要がないため。
    // メールの差出人表示名（fromName）には教室名を残す。
    title: '授業報告書が公開されました',
    body: [
      `${studentName} さんの ${lessonLabel} の授業報告書が公開されました。`,
      '',
      'マイページの「授業報告書」からご覧いただけます。',
    ].join('\n'),
    fromName: schoolName,
  });

  // 送達結果を記録（障害調査用。失敗しても通知の再送はしない＝冪等を優先）。
  await svc
    .from('portal_report_notifications')
    .update({ result: results })
    .eq('report_id', reportId);

  return NextResponse.json({ ok: true, results });
}

/** 'YYYY-MM-DD' → '7月14日(月)'（Date を介さず月日を取り、曜日だけ UTC 正午で判定）。 */
function formatLessonDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = ['日', '月', '火', '水', '木', '金', '土'][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ];
  return `${m}月${d}日(${dow})`;
}
