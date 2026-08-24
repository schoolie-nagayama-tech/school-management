/**
 * 特別講座の受講料を請求へ同期するための純粋ロジック。
 *
 * 正典: docs/special-courses-plan.md フェーズ2-B
 *
 * セルに入れるのは **金額（円）**。講座ごとに単価が違うため、回数ではなく金額を合算する。
 * DB アクセスは一切しない（読み込みは lib/api/billing.ts の責務）。金銭に直結するため
 * 計算部分だけをここに切り出してテストで固定する。
 *
 * ★ 受講回数は「planWeeklyEntries（週次生成と同じ純関数）の結果を絞り込んで数える」。
 *   曜日の出現数から自前で数え直すと、講習期上書き（定期停止・日程差し替え・その期は開催しない）
 *   が二重実装になり、座席表と請求でコマ数がズレる。生成と同じ関数を通せば定義上一致する。
 */
import type { PlannedEntry } from '@/lib/schedule/specialCourseOverride';
import { computeCourseExtraSplit, type CourseExtraSplit } from '@/lib/utils/billingCharged';

/** 金額計算に必要な講座の最小形（special_courses の必要列だけ） */
export interface SpecialCoursePricing {
  id: string;
  name: string;
  /** 1回あたりの単価（円）。NULL は「未設定」＝計上せず講座名を警告に出す */
  unit_price: number | null;
}

/** 講習講座の申込1行の最小形（koushu_enrollments の必要列だけ） */
export interface KoushuEnrollmentLike {
  student_id: string;
  course_id: string | null;
  koma_count: number | null;
}

/** 金額集計の結果 */
export interface SpecialCourseAmountResult {
  /** 生徒ID → 合計金額（円）。0円の生徒は含めない（請求行を作らないため） */
  amountByStudent: Map<string, number>;
  /**
   * 単価未設定のため計上できなかった講座名（重複なし・出現順）。
   * 黙って0円にすると「同期したのに載らない」原因が現場で追えないので、必ず呼び出し側で知らせる。
   */
  missingPriceCourseNames: string[];
}

/** 対象月（year は西暦、month は 1-12） */
export interface BillingMonth {
  year: number;
  month: number;
}

// ============================================================
// 対象月の決定
// ============================================================

/**
 * 請求期間名 "YYYY年M月" から対象月を読む。パースできなければ null。
 *
 * 全角数字や "2026年 4月分" のような表記ゆれも拾えるよう、数字の並びだけを見る。
 */
export function parseBillingPeriodMonth(
  periodName: string | null | undefined
): BillingMonth | null {
  if (!periodName) return null;
  // 全角数字を半角に寄せてから数値を拾う（手入力の期間名に全角が混じることがある）
  const normalized = periodName.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  const matched = normalized.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * 同期ダイアログの既定の対象月。請求期間名のパース結果を優先し、
 * 読めなければ請求期間の開始日の月に落とす。どちらも無ければ今日の月。
 *
 * 月謝先取りの商習慣（5週目ロジックが請求月+1ヶ月を見る）があるため、既定は出すが固定はしない
 * （呼び出し側でユーザーに選ばせる）。
 */
export function resolveDefaultBillingMonth(
  periodName: string | null | undefined,
  periodStartDate: string | null | undefined,
  today: Date = new Date()
): BillingMonth {
  const parsed = parseBillingPeriodMonth(periodName);
  if (parsed) return parsed;
  if (periodStartDate) {
    const m = periodStartDate.match(/^(\d{4})-(\d{2})/);
    if (m) return { year: Number(m[1]), month: Number(m[2]) };
  }
  return { year: today.getFullYear(), month: today.getMonth() + 1 };
}

// ============================================================
// 対象月に重なる週（planWeeklyEntries に渡す月曜日）
// ============================================================

/** 'YYYY-MM-DD' を UTC の Date にする（planWeeklyEntries の weekDaysOf と同じ刻み方に揃える） */
function utcDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

/** UTC の Date を 'YYYY-MM-DD' にする */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 対象月に1日でも重なる週の月曜日を昇順で返す。
 *
 * planWeeklyEntries は「月曜はじまりの7日間」を計画するので、月初・月末を含む週も
 * 取りこぼさないように月初の週の月曜から月末の週の月曜までを列挙する。
 * 週の一部が対象月の外にはみ出す分は、後段の日付フィルタ（月内判定）で落とす。
 */
export function weekStartsCoveringMonth(month: BillingMonth): string[] {
  const first = new Date(Date.UTC(month.year, month.month - 1, 1));
  const last = new Date(Date.UTC(month.year, month.month, 0));
  // getUTCDay: 0=日曜。月曜起点にするため日曜だけ6日戻す
  const toMonday = (d: Date): Date => {
    const shift = d.getUTCDay() === 0 ? -6 : 1 - d.getUTCDay();
    const m = new Date(d);
    m.setUTCDate(d.getUTCDate() + shift);
    return m;
  };
  const startMonday = toMonday(first);
  const endMonday = toMonday(last);
  const result: string[] = [];
  const cur = new Date(startMonday);
  while (cur.getTime() <= endMonday.getTime()) {
    result.push(ymd(cur));
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return result;
}

/** 対象月の期間（'YYYY-MM-DD'）。カバーする全週の範囲＝上書き入力の読み込み範囲に使う */
export function monthWeekRange(month: BillingMonth): { from: string; to: string } {
  const weeks = weekStartsCoveringMonth(month);
  const lastSunday = utcDate(weeks[weeks.length - 1]);
  lastSunday.setUTCDate(lastSunday.getUTCDate() + 6);
  return { from: weeks[0], to: ymd(lastSunday) };
}

/** その日付が対象月に含まれるか */
export function isInMonth(date: string, month: BillingMonth): boolean {
  return date.startsWith(`${month.year}-${String(month.month).padStart(2, '0')}-`);
}

// ============================================================
// 受講回数の集計・金額合算
// ============================================================

/** 生徒ID → 講座ID → その月の受講回数 */
export type MonthlySessionCounts = Map<string, Map<string, number>>;

/**
 * 週ごとの planWeeklyEntries の結果から、対象月の「講座由来のコマ」を生徒×講座で数える。
 *
 * 絞り込みは仕様どおり「specialCourseId != null（定期・上書きの両方）」かつ「日付が対象月内」。
 * 同じコマ（date × コマ × 生徒 × 講座）が複数週の計画に現れることは無い想定だが、
 * 呼び出し側が週を重複して渡しても二重計上しないようキーで排除する。
 */
export function countMonthlySessions(
  plannedWeeks: PlannedEntry[][],
  month: BillingMonth
): MonthlySessionCounts {
  const counts: MonthlySessionCounts = new Map();
  const seen = new Set<string>();
  for (const week of plannedWeeks) {
    for (const entry of week) {
      const courseId = entry.specialCourseId;
      if (!courseId) continue;
      if (!isInMonth(entry.date, month)) continue;
      const key = `${entry.date}-${entry.timeSlotId}-${entry.studentId}-${courseId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const byCourse = counts.get(entry.studentId) ?? new Map<string, number>();
      byCourse.set(courseId, (byCourse.get(courseId) ?? 0) + 1);
      counts.set(entry.studentId, byCourse);
    }
  }
  return counts;
}

/**
 * 通年講座の金額を生徒ごとに合算する。`Σ(講座ごと: unit_price × その月の受講回数)`。
 *
 * - 単価 NULL の講座は計上せず、講座名を missingPriceCourseNames に積む（黙って0円にしない）。
 * - courses に無い講座ID（無効化済み・他教室など）は対象外として無視する。
 */
export function aggregateYearRoundAmounts(
  counts: MonthlySessionCounts,
  courses: SpecialCoursePricing[]
): SpecialCourseAmountResult {
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const amountByStudent = new Map<string, number>();
  const missing: string[] = [];

  for (const [studentId, byCourse] of Array.from(counts.entries())) {
    let amount = 0;
    for (const [courseId, sessions] of Array.from(byCourse.entries())) {
      const course = courseById.get(courseId);
      if (!course) continue;
      if (course.unit_price == null) {
        if (sessions > 0 && !missing.includes(course.name)) missing.push(course.name);
        continue;
      }
      amount += course.unit_price * sessions;
    }
    if (amount > 0) amountByStudent.set(studentId, amount);
  }

  return { amountByStudent, missingPriceCourseNames: missing };
}

/**
 * 講習講座の金額を生徒ごとに合算する。`Σ(講座ごと: unit_price × koma_count)`。
 *
 * 講習講座は「その期に1回」の受講料なので、申込（koushu_enrollments）のコマ数をそのまま単価に掛ける。
 * 単価 NULL の扱いは通年講座と同じ。
 */
export function aggregateKoushuAmounts(
  enrollments: KoushuEnrollmentLike[],
  courses: SpecialCoursePricing[]
): SpecialCourseAmountResult {
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const amountByStudent = new Map<string, number>();
  const missing: string[] = [];

  for (const enrollment of enrollments) {
    if (!enrollment.course_id || !enrollment.student_id) continue;
    const course = courseById.get(enrollment.course_id);
    if (!course) continue;
    const koma = enrollment.koma_count ?? 0;
    if (koma <= 0) continue;
    if (course.unit_price == null) {
      if (!missing.includes(course.name)) missing.push(course.name);
      continue;
    }
    const amount = course.unit_price * koma;
    if (amount <= 0) continue;
    amountByStudent.set(
      enrollment.student_id,
      (amountByStudent.get(enrollment.student_id) ?? 0) + amount
    );
  }

  return { amountByStudent, missingPriceCourseNames: missing };
}

// ============================================================
// 計上済み／未計上の内訳
// ============================================================

/**
 * 計上済み(quantity)／未計上(value_number)の内訳。増コマ同期と **同じ split 規約** をそのまま使う。
 *
 * 単位がコマ→円に変わるだけで、「既存の計上済みは保持し、新しい合計との差分だけ未計上に出す。
 * 合計が計上済みを下回ったら計上済みを合計まで切り下げる」という意味は同一。
 * 規約を1箇所に保つため、実体は billingCharged.computeCourseExtraSplit に委譲する。
 */
export function computeSpecialCourseSplit(prevCharged: number, total: number): CourseExtraSplit {
  return computeCourseExtraSplit(prevCharged, total);
}
