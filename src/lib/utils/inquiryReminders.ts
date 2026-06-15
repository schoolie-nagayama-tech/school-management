/**
 * 問合せリマインド算出の純関数ユーティリティ。
 * DB / Supabase 依存なし。アラートエンジン(alerts.ts)とは分離したベータ実装。
 */

import type { Inquiry } from '@/types/database';

// ============================================================
// 型定義
// ============================================================

/** リマインドの種別 */
export type InquiryReminderKind =
  | 'first_contact_overdue' // 初回コンタクト未実施
  | 'response_delay'        // 対応遅延（3/5/7/10/14/21/30日）
  | 'material_unsent'       // 資料未発送
  | 'trial_followup';       // 体験後フォロー

/** 個々のリマインド情報 */
export interface InquiryReminder {
  inquiryId: string;
  schoolId: string;
  /** 表示名（生徒名 or 保護者名）*/
  name: string;
  kind: InquiryReminderKind;
  /** UI に表示するメッセージ文 */
  message: string;
  /** 基準日からの経過日数（trial_followup のみ体験日からの経過日数）*/
  daysSince: number;
  severity: 'info' | 'warning' | 'danger';
}

// ============================================================
// 内部定数
// ============================================================

/** response_delay を発火させる経過日数のセット（GAS 互換） */
const DELAY_MILESTONES = new Set([3, 5, 7, 10, 14, 21, 30]);

/**
 * リマインドの対象とする「問合せからの経過日数」の上限。
 * HPから過去問合せ（数年分）を一括取込すると、古い未決着案件が大量に
 * 「初回コンタクト未実施」等を出してノイズになるため、直近 N 日以内に限定する。
 * これより古い問合せは行動対象ではない（実質終了）とみなしリマインドしない。
 */
const REMINDER_WINDOW_DAYS = 60;

/** severity の重み（ソート用） */
const SEVERITY_ORDER: Record<InquiryReminder['severity'], number> = {
  danger: 0,
  warning: 1,
  info: 2,
};

/** 1 日をミリ秒で表した定数 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ============================================================
// ヘルパー
// ============================================================

/** ISO 文字列 → Date 変換（null なら null を返す） */
function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 2 日時の差を日単位（切り捨て）で返す。
 * result = floor((later - earlier) / 1日)
 */
function daysDiff(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / MS_PER_DAY);
}

/** Inquiry から表示名を取得する（未登録なら固定文字列） */
function displayName(inquiry: Inquiry): string {
  return inquiry.student_name || inquiry.guardian_name || '（名前未登録）';
}

// ============================================================
// メインエクスポート
// ============================================================

/**
 * 問合せ群からリマインドを算出する純関数。
 *
 * @param inquiries 対象の問合せ（deleted_at 除外済みを想定）
 * @param contactedIds コンタクト履歴が 1 件以上ある inquiry_id の集合（初回未接触判定用）
 * @param now 基準日時
 * @returns severity(danger>warning>info)→daysSince 降順で並んだリマインド配列
 */
export function computeInquiryReminders(
  inquiries: Inquiry[],
  contactedIds: Set<string>,
  now: Date
): InquiryReminder[] {
  const reminders: InquiryReminder[] = [];

  for (const inquiry of inquiries) {
    const inquiredAt = parseDate(inquiry.inquired_at);
    if (!inquiredAt) continue;

    const name = displayName(inquiry);
    const daysSince = daysDiff(inquiredAt, now);

    // 直近 N 日より古い問合せはリマインド対象外（過去データ一括取込のノイズ防止）。
    // ただし trial_followup は体験日基準なので、このガード後に体験日で別途判定する。
    const withinWindow = daysSince <= REMINDER_WINDOW_DAYS;

    // ---- 1. first_contact_overdue ----
    // 条件: status === 'in_progress' かつ contactedIds に無い かつ 1 <= daysSince <= 上限
    if (
      withinWindow &&
      inquiry.status === 'in_progress' &&
      !contactedIds.has(inquiry.id) &&
      daysSince >= 1
    ) {
      const severity: InquiryReminder['severity'] = daysSince >= 3 ? 'danger' : 'warning';
      reminders.push({
        inquiryId: inquiry.id,
        schoolId: inquiry.school_id,
        name,
        kind: 'first_contact_overdue',
        message: `初回コンタクト未実施（${daysSince}日経過）`,
        daysSince,
        severity,
      });
    }

    // ---- 2. response_delay ----
    // 条件: status が in_progress か unreachable かつ trial_at=null かつ interview_at=null
    //        かつ daysSince が DELAY_MILESTONES のいずれかに一致
    if (
      (inquiry.status === 'in_progress' || inquiry.status === 'unreachable') &&
      !inquiry.trial_at &&
      !inquiry.interview_at &&
      DELAY_MILESTONES.has(daysSince)
    ) {
      const severity: InquiryReminder['severity'] =
        daysSince >= 14 ? 'danger' : daysSince >= 7 ? 'warning' : 'info';
      reminders.push({
        inquiryId: inquiry.id,
        schoolId: inquiry.school_id,
        name,
        kind: 'response_delay',
        message: `対応から${daysSince}日経過。次アクションを`,
        daysSince,
        severity,
      });
    }

    // ---- 3. material_unsent ----
    // 条件: status === 'in_progress'（決着済みには資料催促しない）かつ
    //        request_type === '資料請求' かつ material_sent_at === null かつ daysSince >= 3
    if (
      withinWindow &&
      inquiry.status === 'in_progress' &&
      inquiry.request_type === '資料請求' &&
      !inquiry.material_sent_at &&
      daysSince >= 3
    ) {
      reminders.push({
        inquiryId: inquiry.id,
        schoolId: inquiry.school_id,
        name,
        kind: 'material_unsent',
        message: `資料未発送（${daysSince}日経過）`,
        daysSince,
        severity: 'warning',
      });
    }

    // ---- 4. trial_followup ----
    // 条件: trial_at が非 null かつ trial_at < (now - 1日) かつ status === 'in_progress'
    // daysSince はここでは体験日からの経過日数を使う
    const trialAt = parseDate(inquiry.trial_at);
    if (trialAt && inquiry.status === 'in_progress') {
      const oneDayBefore = new Date(now.getTime() - MS_PER_DAY);
      const trialDays = daysDiff(trialAt, now);
      // 体験日が直近 N 日以内のものだけ（古い体験はフォロー対象外）
      if (trialAt < oneDayBefore && trialDays <= REMINDER_WINDOW_DAYS) {
        reminders.push({
          inquiryId: inquiry.id,
          schoolId: inquiry.school_id,
          name,
          kind: 'trial_followup',
          message: `体験後フォロー未完了（体験から${trialDays}日）`,
          daysSince: trialDays,
          severity: 'warning',
        });
      }
    }
  }

  // ---- 並び替え: severity(danger>warning>info)→daysSince 降順 ----
  reminders.sort((a, b) => {
    const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.daysSince - a.daysSince;
  });

  return reminders;
}
