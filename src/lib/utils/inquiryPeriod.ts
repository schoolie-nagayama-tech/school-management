/**
 * 問合せ管理の期間プリセット計算ユーティリティ。
 * 副作用なし・外部依存なし。JST 固定で YYYY-MM-DD 境界を返す。
 */

// ============================================================
// 公開型定義
// ============================================================

/** 期間プリセット種別 */
export type PeriodPreset =
  | 'this_month'
  | 'last_month'
  | 'last_30_days'
  | 'last_90_days'
  | 'this_quarter'
  | 'this_year'
  | 'last_year'
  | 'all_time'
  | 'custom';

/** resolvePeriod の戻り値。空文字は境界なし（全期間の片端）を意味する。 */
export interface ResolvedPeriod {
  dateFrom: string; // YYYY-MM-DD または ''
  dateTo: string;   // YYYY-MM-DD または ''
}

/** プリセットの表示ラベル */
export const PRESET_LABELS: Record<PeriodPreset, string> = {
  this_month:   '今月',
  last_month:   '先月',
  last_30_days: '直近30日',
  last_90_days: '直近90日',
  this_quarter: '今四半期',
  this_year:    '今年',
  last_year:    '去年',
  all_time:     '全期間',
  custom:       'カスタム',
};

// ============================================================
// 内部ユーティリティ
// ============================================================

/**
 * UTC の Date を JST に変換して YYYY-MM-DD 文字列を返す。
 * JST = UTC + 9h。
 */
function toJstDateString(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * now の JST 年・月・日を返す。
 */
function jstParts(now: Date): { year: number; month: number; day: number } {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    year:  jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1, // 1-indexed
    day:   jst.getUTCDate(),
  };
}

/**
 * 月の末日を返す。
 * 例: (2026, 2) → 28。(2024, 2) → 29。
 */
function lastDayOfMonth(year: number, month: number): number {
  // 翌月1日の1日前 = その月の末日
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * YYYY-MM-DD 形式の文字列を生成する。
 */
function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ============================================================
// 公開関数
// ============================================================

/**
 * プリセットから JST の日付境界（YYYY-MM-DD）を解決する。
 *
 * - custom / all_time は dateFrom/dateTo に空文字を返す（または custom の場合は引数をそのまま返す）。
 * - now 未指定なら new Date() を使う（単体テスト時に差し込み可能）。
 *
 * 例（now = 2026-06-16 JST）:
 *   this_month   → 2026-06-01 〜 2026-06-30
 *   last_month   → 2026-05-01 〜 2026-05-31
 *   last_30_days → 2026-05-17 〜 2026-06-16
 *   last_90_days → 2026-03-18 〜 2026-06-16
 *   this_quarter → 2026-04-01 〜 2026-06-30（Q2）
 *   this_year    → 2026-01-01 〜 2026-12-31
 *   last_year    → 2025-01-01 〜 2025-12-31
 *   all_time     → '' 〜 ''
 *   custom       → customFrom 〜 customTo（そのまま）
 */
export function resolvePeriod(
  preset: PeriodPreset,
  customFrom = '',
  customTo = '',
  now: Date = new Date()
): ResolvedPeriod {
  if (preset === 'all_time') {
    return { dateFrom: '', dateTo: '' };
  }

  if (preset === 'custom') {
    return { dateFrom: customFrom, dateTo: customTo };
  }

  const { year, month, day } = jstParts(now);

  switch (preset) {
    case 'this_month': {
      const from = ymd(year, month, 1);
      const to   = ymd(year, month, lastDayOfMonth(year, month));
      return { dateFrom: from, dateTo: to };
    }

    case 'last_month': {
      // 先月の年月を計算する
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear  = month === 1 ? year - 1 : year;
      const from = ymd(prevYear, prevMonth, 1);
      const to   = ymd(prevYear, prevMonth, lastDayOfMonth(prevYear, prevMonth));
      return { dateFrom: from, dateTo: to };
    }

    case 'last_30_days': {
      // JST の今日の日付ベースで 30 日前を計算する（今日含む31日間ではなく、今日から遡って30日前が起点）。
      // now.getTime() のミリ秒引き算は UTC 基点になり JST 日付境界とずれるため、
      // Date.UTC で JST 年月日から直接 day-30 で計算する（JS の Date.UTC はオーバーフローを自動補正する）。
      const fromUtc = new Date(Date.UTC(year, month - 1, day - 30));
      return {
        dateFrom: `${fromUtc.getUTCFullYear()}-${String(fromUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(fromUtc.getUTCDate()).padStart(2, '0')}`,
        dateTo:   ymd(year, month, day),
      };
    }

    case 'last_90_days': {
      // JST の今日の日付ベースで 90 日前を計算する。
      const fromUtc = new Date(Date.UTC(year, month - 1, day - 90));
      return {
        dateFrom: `${fromUtc.getUTCFullYear()}-${String(fromUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(fromUtc.getUTCDate()).padStart(2, '0')}`,
        dateTo:   ymd(year, month, day),
      };
    }

    case 'this_quarter': {
      // Q1: 1-3月, Q2: 4-6月, Q3: 7-9月, Q4: 10-12月
      const quarterStart = Math.floor((month - 1) / 3) * 3 + 1; // 1, 4, 7, 10
      const quarterEnd   = quarterStart + 2;                      // 3, 6, 9, 12
      const from = ymd(year, quarterStart, 1);
      const to   = ymd(year, quarterEnd, lastDayOfMonth(year, quarterEnd));
      return { dateFrom: from, dateTo: to };
    }

    case 'this_year': {
      return {
        dateFrom: ymd(year, 1, 1),
        dateTo:   ymd(year, 12, 31),
      };
    }

    case 'last_year': {
      const prevYear = year - 1;
      return {
        dateFrom: ymd(prevYear, 1, 1),
        dateTo:   ymd(prevYear, 12, 31),
      };
    }

    default:
      // 型上は到達しないが念のため全期間を返す
      return { dateFrom: '', dateTo: '' };
  }
}

/**
 * 期間を yearOffset 年分スライドして返す（年比較用）。
 * dateFrom / dateTo の年を yearOffset だけ加算する。
 *
 * 2/29 を含む場合: JavaScript の Date が自動的に 3/1 に繰り上げるため、
 * 1日戻して 2/28 にクランプする処理を行う。
 *
 * 空文字の場合はそのまま返す（all_time 等の境界なし端はスライドしない）。
 *
 * @param period  元の期間
 * @param yearOffset  年オフセット（-1 で前年、+1 で翌年）
 */
export function shiftByYear(period: ResolvedPeriod, yearOffset: number): ResolvedPeriod {
  const shiftDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    // 年をオフセット後、Date で正規化する
    const shifted = new Date(Date.UTC(y + yearOffset, (m ?? 1) - 1, d ?? 1));
    // 月が変わっていたら（2/29→3/1 等）前日（=2/28）に戻す
    const shiftedMonth = shifted.getUTCMonth() + 1;
    if (shiftedMonth !== (m ?? 1)) {
      // 1日前に戻す
      shifted.setUTCDate(shifted.getUTCDate() - 1);
    }
    const ny   = shifted.getUTCFullYear();
    const nm   = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const nd   = String(shifted.getUTCDate()).padStart(2, '0');
    return `${ny}-${nm}-${nd}`;
  };

  return {
    dateFrom: shiftDate(period.dateFrom),
    dateTo:   shiftDate(period.dateTo),
  };
}

/**
 * 期間の表示用ラベルを生成する。
 * 例: "2026/01/01 〜 2026/06/30"
 *
 * dateFrom / dateTo が両方空 → "全期間"
 * 片方のみ空  → "〜 2026/06/30" のように出力する
 */
export function formatPeriodLabel(period: ResolvedPeriod): string {
  const fmt = (s: string) => s.replace(/-/g, '/');

  if (!period.dateFrom && !period.dateTo) return '全期間';
  if (!period.dateFrom) return `〜 ${fmt(period.dateTo)}`;
  if (!period.dateTo)   return `${fmt(period.dateFrom)} 〜`;
  return `${fmt(period.dateFrom)} 〜 ${fmt(period.dateTo)}`;
}
