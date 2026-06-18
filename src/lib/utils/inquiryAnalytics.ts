/**
 * 問合せ分析の純粋集計関数。
 * DB・React・副作用に依存せず、Inquiry[] → InquiryAnalytics を計算する。
 * このファイルは副作用を持たないため、テストしやすい。
 */

import type { Inquiry } from '@/types/database';

// ============================================================
// 公開型定義
// ============================================================

/** 問合せステータスごとの件数。ラベルは日本語。 */
export interface StatusCount {
  status: string;
  label: string;
  count: number;
}

/** 問合せ → 体験 → 入面 → 入会 の各段階の件数と前段比率。 */
export interface FunnelStage {
  stage: string;
  count: number;
  /** 前段を 100% とした比率(%)。最初の段は 100。小数1桁。 */
  rate: number;
}

/**
 * 月次集計。inquired_at を JST "YYYY-MM" でグループ化。
 * enrolled はその月に問合せた行の中で status==='enrolled' の件数。
 */
export interface MonthlyPoint {
  month: string;
  inquiries: number;
  enrolled: number;
  /** 入会率(%) = enrolled / inquiries * 100。小数1桁。 */
  rate: number;
}

/** 媒体別の集計。件数降順で並ぶ。 */
export interface MediaStat {
  media: string;
  count: number;
  enrolled: number;
  /** 入会率(%) */
  enrollRate: number;
  /** 連絡不通率(%) */
  unreachableRate: number;
}

/** リードタイムの統計（中央値・平均・対象件数）。 */
export interface LeadTimeStat {
  median: number;
  avg: number;
  n: number;
}

/** 郵便番号エリア別集計（前3桁でグループ化）。count 降順上位15。 */
export interface PostalStat {
  postal: string;   // 例: "206-"
  count: number;
  enrolled: number;
}

/** 在籍学校名別集計。count 降順上位15。 */
export interface SchoolNameStat {
  schoolName: string;
  count: number;
  enrolled: number;
  enrollRate: number;
}

/** 失注理由別集計。lost / trial_lost のみ対象。count 降順。 */
export interface LostReasonStat {
  reason: string;  // lost_reason null/空 → '未記録'
  count: number;
}

/** computeInquiryAnalytics の戻り値。 */
export interface InquiryAnalytics {
  total: number;
  /** 全ステータス5値の件数。0件のステータスも含む。 */
  statusCounts: StatusCount[];
  funnel: FunnelStage[];
  monthly: MonthlyPoint[];
  byMedia: MediaStat[];
  leadTime: {
    /** 問合せ日 → 入会日 */
    inquiryToEnroll: LeadTimeStat;
    /** 体験日 → 入会日 */
    trialToEnroll: LeadTimeStat;
  };
  /** 郵便番号エリア別（前3桁グループ、上位15） */
  byPostal: PostalStat[];
  /** 在籍学校名別（上位15） */
  bySchoolName: SchoolNameStat[];
  /** 失注理由別内訳（lost / trial_lost のみ） */
  lostReasons: LostReasonStat[];
}

// ============================================================
// 内部定数
// ============================================================

/** 表示ラベルの定義。7値すべてを網羅する。 */
const STATUS_LABELS: Record<string, string> = {
  in_progress: '対応中',
  trial_waiting: '体験待ち',
  trial_done: '体験済み',
  enrolled: '入会',
  unreachable: '連絡不通',
  lost: '没',
  trial_lost: '体験没',
};

/** ステータスの表示順（PieChart 等で並び順を安定させる）。 */
const STATUS_ORDER = ['enrolled', 'trial_done', 'trial_waiting', 'in_progress', 'trial_lost', 'unreachable', 'lost'] as const;

// ============================================================
// ユーティリティ関数
// ============================================================

/**
 * ISO 文字列 or date 文字列を Date に変換する。
 * 解析失敗（NaN）の場合は null を返す。
 */
function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 2つの Date の差を日数（floor）で返す。
 * 負の値になる場合も許容するが、leadTime 計算では除外する。
 */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * UTC の Date を JST の "YYYY-MM" 文字列に変換する。
 * JST = UTC + 9時間。
 */
function toJstYearMonth(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * 数値配列の中央値を返す。空配列の場合は 0。
 * 偶数個の場合は下側の値を使う（floor ベース）。
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * 数値配列の平均を小数1桁で返す。空配列の場合は 0。
 */
function avg(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

// ============================================================
// メイン集計関数
// ============================================================

/**
 * Inquiry[] を受け取り、分析画面で使うすべての集計を返す。
 * 副作用なし。外部呼び出しなし。
 *
 * @param inquiries getInquiries() の戻り値
 */
export function computeInquiryAnalytics(inquiries: Inquiry[]): InquiryAnalytics {
  const total = inquiries.length;

  // ---- 1. ステータス別件数 ----
  // 5値すべてを 0 初期化してから集計する（0件でも表示するため）
  const statusMap = new Map<string, number>(STATUS_ORDER.map((s) => [s, 0]));
  for (const inq of inquiries) {
    const prev = statusMap.get(inq.status) ?? 0;
    statusMap.set(inq.status, prev + 1);
  }
  const statusCounts: StatusCount[] = STATUS_ORDER.map((s) => ({
    status: s,
    label: STATUS_LABELS[s] ?? s,
    count: statusMap.get(s) ?? 0,
  }));

  // ---- 2. ファネル（問合せ → 体験 → 入面 → 入会） ----
  const funnelCounts = [
    total,
    inquiries.filter((q) => q.trial_at != null).length,
    inquiries.filter((q) => q.interview_at != null).length,
    inquiries.filter((q) => q.status === 'enrolled').length,
  ];
  const funnelStages = ['問合せ', '体験', '入面', '入会'];
  const funnel: FunnelStage[] = funnelStages.map((stage, i) => {
    const count = funnelCounts[i];
    const prev = i === 0 ? total : funnelCounts[i - 1];
    // 前段が 0 のときは rate を 0 にする（NaN 防止）
    const rate = i === 0 ? 100 : prev > 0 ? Math.round((count / prev) * 1000) / 10 : 0;
    return { stage, count, rate };
  });

  // ---- 3. 月次推移 ----
  // inquired_at を JST "YYYY-MM" でグループ化し、月ごとの問合せ数と入会数を集計する
  type MonthAccum = { inquiries: number; enrolled: number };
  const monthMap = new Map<string, MonthAccum>();

  for (const inq of inquiries) {
    const d = parseDate(inq.inquired_at);
    if (!d) continue;
    const key = toJstYearMonth(d);
    if (!monthMap.has(key)) monthMap.set(key, { inquiries: 0, enrolled: 0 });
    const acc = monthMap.get(key)!;
    acc.inquiries++;
    // その月に問合せたもので入会したもの（入会日ではなく問合せ月で集計）
    if (inq.status === 'enrolled') acc.enrolled++;
  }

  // 月昇順でソートして配列化する
  const monthly: MonthlyPoint[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, acc]) => ({
      month,
      inquiries: acc.inquiries,
      enrolled: acc.enrolled,
      rate: acc.inquiries > 0
        ? Math.round((acc.enrolled / acc.inquiries) * 1000) / 10
        : 0,
    }));

  // ---- 4. 媒体別集計 ----
  type MediaAccum = { count: number; enrolled: number; unreachable: number };
  const mediaMap = new Map<string, MediaAccum>();

  for (const inq of inquiries) {
    // null/空文字は "未設定" に統一する
    const key = inq.media && inq.media.trim() ? inq.media.trim() : '未設定';
    if (!mediaMap.has(key)) mediaMap.set(key, { count: 0, enrolled: 0, unreachable: 0 });
    const acc = mediaMap.get(key)!;
    acc.count++;
    if (inq.status === 'enrolled') acc.enrolled++;
    if (inq.status === 'unreachable') acc.unreachable++;
  }

  // 件数降順でソートする
  const byMedia: MediaStat[] = Array.from(mediaMap.entries())
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([media, acc]) => ({
      media,
      count: acc.count,
      enrolled: acc.enrolled,
      enrollRate: acc.count > 0
        ? Math.round((acc.enrolled / acc.count) * 1000) / 10
        : 0,
      unreachableRate: acc.count > 0
        ? Math.round((acc.unreachable / acc.count) * 1000) / 10
        : 0,
    }));

  // ---- 5. リードタイム ----
  // status==='enrolled' かつ両方の日付がある行のみ集計する
  const inquiryToEnrollDays: number[] = [];
  const trialToEnrollDays: number[] = [];

  for (const inq of inquiries) {
    if (inq.status !== 'enrolled') continue;

    const inquiredAt = parseDate(inq.inquired_at);
    const enrolledAt = parseDate(inq.enrolled_at);
    const trialAt = parseDate(inq.trial_at);

    // 問合せ → 入会（日数が 0 以上のもの）
    if (inquiredAt && enrolledAt) {
      const days = daysBetween(inquiredAt, enrolledAt);
      if (days >= 0) inquiryToEnrollDays.push(days);
    }

    // 体験 → 入会（日数が 0 以上のもの）
    if (trialAt && enrolledAt) {
      const days = daysBetween(trialAt, enrolledAt);
      if (days >= 0) trialToEnrollDays.push(days);
    }
  }

  const leadTime = {
    inquiryToEnroll: {
      median: median(inquiryToEnrollDays),
      avg: avg(inquiryToEnrollDays),
      n: inquiryToEnrollDays.length,
    },
    trialToEnroll: {
      median: median(trialToEnrollDays),
      avg: avg(trialToEnrollDays),
      n: trialToEnrollDays.length,
    },
  };

  // ---- 6. 郵便番号エリア別集計 ----
  // postal_code の数字のみ抽出 → 先頭3桁でグループ化。"206-" 形式で表示キーを作る。
  type PostalAccum = { count: number; enrolled: number };
  const postalMap = new Map<string, PostalAccum>();

  for (const inq of inquiries) {
    if (!inq.postal_code) continue;
    // ハイフン等の非数字を除去して先頭3桁を取る
    const digits = inq.postal_code.replace(/\D/g, '');
    if (digits.length < 3) continue;
    const key = digits.slice(0, 3) + '-';
    if (!postalMap.has(key)) postalMap.set(key, { count: 0, enrolled: 0 });
    const acc = postalMap.get(key)!;
    acc.count++;
    if (inq.status === 'enrolled') acc.enrolled++;
  }

  const byPostal: PostalStat[] = Array.from(postalMap.entries())
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 15)
    .map(([postal, acc]) => ({ postal, count: acc.count, enrolled: acc.enrolled }));

  // ---- 7. 在籍学校名別集計 ----
  // school_name が null / 空の行は除外する。count 降順上位15。
  type SchoolAccum = { count: number; enrolled: number };
  const schoolMap = new Map<string, SchoolAccum>();

  for (const inq of inquiries) {
    const name = inq.school_name && inq.school_name.trim() ? inq.school_name.trim() : null;
    if (!name) continue;
    if (!schoolMap.has(name)) schoolMap.set(name, { count: 0, enrolled: 0 });
    const acc = schoolMap.get(name)!;
    acc.count++;
    if (inq.status === 'enrolled') acc.enrolled++;
  }

  const bySchoolName: SchoolNameStat[] = Array.from(schoolMap.entries())
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 15)
    .map(([schoolName, acc]) => ({
      schoolName,
      count: acc.count,
      enrolled: acc.enrolled,
      enrollRate: acc.count > 0 ? Math.round((acc.enrolled / acc.count) * 1000) / 10 : 0,
    }));

  // ---- 8. 失注理由別集計 ----
  // lost / trial_lost のみ対象。lost_reason null / 空 → '未記録'。count 降順。
  const lostReasonMap = new Map<string, number>();

  for (const inq of inquiries) {
    if (inq.status !== 'lost' && inq.status !== 'trial_lost') continue;
    const reason =
      inq.lost_reason && inq.lost_reason.trim() ? inq.lost_reason.trim() : '未記録';
    lostReasonMap.set(reason, (lostReasonMap.get(reason) ?? 0) + 1);
  }

  const lostReasons: LostReasonStat[] = Array.from(lostReasonMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([reason, count]) => ({ reason, count }));

  return { total, statusCounts, funnel, monthly, byMedia, leadTime, byPostal, bySchoolName, lostReasons };
}
