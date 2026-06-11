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
}

// ============================================================
// 内部定数
// ============================================================

/** 表示ラベルの定義。5値すべてを網羅する。 */
const STATUS_LABELS: Record<string, string> = {
  in_progress: '対応中',
  enrolled: '入会',
  unreachable: '連絡不通',
  lost: '没',
  trial_lost: '体験没',
};

/** ステータスの表示順（PieChart 等で並び順を安定させる）。 */
const STATUS_ORDER = ['enrolled', 'in_progress', 'trial_lost', 'unreachable', 'lost'] as const;

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

  return { total, statusCounts, funnel, monthly, byMedia, leadTime };
}
