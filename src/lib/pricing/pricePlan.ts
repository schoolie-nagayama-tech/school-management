/**
 * 料金マスタ（price_plans / price_plan_items）の読み取り。
 *
 * ★ この表は「配布元」であって「請求の正典」ではない。
 *   期間や申込に配ったあとの金額は、これまでどおりその場にスナップショットで残す
 *   （form_periods.settings.price_table など）。マスタを直しても過去の請求額は動かない。
 *   請求済みの金額が改定のたびに書き換わると監査できなくなるため。
 *
 * ★ 版は effective_from。「その日に有効な料金表」を1つ選んでから明細を引く。
 *   改定のたびに price_plans に1行増やし、過去の版は消さない。
 *
 * ★ 学年は数値で扱う（小1=1 … 小6=6 / 中1=7 … 中3=9 / 高1=10 … 高3=12、年長=0）。
 *   ラベル文字列で突き合わせると表記ゆれで引き当てが外れるため。
 */

import { supabase } from '@/lib/supabase';

/** 明細の種類 */
export type PriceItemKind =
  /** 個別の月謝（学年×形態×分数×週回数） */
  | 'monthly'
  /** 個別の追加授業＝単コマ（学年×形態×分数） */
  | 'per_koma'
  /** 小集団の月謝（学年×科目数） */
  | 'group_monthly'
  /** 小集団の特別セット料金（学年×科目数） */
  | 'group_set'
  /** 小集団の追加授業＝単コマ（学年） */
  | 'group_per_koma'
  /** 個別＋小集団のセット月謝（学年×組み合わせ） */
  | 'combo_set'
  /** 通年講座の月額（HAL・YSG）。回数によらず月額固定 */
  | 'course_monthly';

/** 指導形態。1=1対1(PS1) / 2=1対2(PS2) */
export type PriceRatio = 1 | 2;

export interface PricePlan {
  id: string;
  /** 料金表に印字されているコード（例 '202609A'） */
  code: string;
  name: string;
  effective_from: string;
  note: string | null;
}

export interface PricePlanItem {
  kind: PriceItemKind;
  grade_min: number;
  grade_max: number;
  duration_minutes: number | null;
  ratio: PriceRatio | null;
  weekly_count: number | null;
  subject_count: number | null;
  variant: string | null;
  amount: number;
}

/** 料金表1版ぶん（版の情報＋明細） */
export interface LoadedPricePlan {
  plan: PricePlan;
  items: PricePlanItem[];
}

/** 'YYYY-MM-DD'（JST基準の今日） */
function todayJst(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

/**
 * 指定日に有効な料金表を読む（既定は今日）。
 * 「その日以前に始まった版のうち最も新しいもの」を選ぶ。1件も無ければ null。
 */
export async function loadPricePlan(asOf: string = todayJst()): Promise<LoadedPricePlan | null> {
  const { data: plan, error } = await supabase
    .from('price_plans')
    .select('id, code, name, effective_from, note')
    .lte('effective_from', asOf)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !plan) {
    if (error) console.error('料金表の取得に失敗しました:', error);
    return null;
  }

  const typedPlan = plan as PricePlan;
  const { data: items, error: itemsError } = await supabase
    .from('price_plan_items')
    .select(
      'kind, grade_min, grade_max, duration_minutes, ratio, weekly_count, subject_count, variant, amount'
    )
    .eq('plan_id', typedPlan.id);

  if (itemsError) {
    console.error('料金明細の取得に失敗しました:', itemsError);
    return null;
  }

  return { plan: typedPlan, items: (items ?? []) as PricePlanItem[] };
}

/** 学年がその明細の対象帯に入っているか */
function coversGrade(item: PricePlanItem, grade: number): boolean {
  return grade >= item.grade_min && grade <= item.grade_max;
}

/**
 * 個別の単コマ（追加授業）単価を引く。
 *
 * duration を省いた場合はその学年で使える分数のうち最も長いものを採る。
 * 学年で標準の分数が決まっている（小1〜4は45分、小5・小6は60分と90分、中学以上は90分）ため、
 * 「学年と形態だけ分かっている」呼び出し側（増コマ申込など）が既定値を得られるようにする。
 */
export function lookupPerKoma(
  items: PricePlanItem[],
  grade: number,
  ratio: PriceRatio,
  duration?: number
): number | null {
  const candidates = items.filter(
    (i) =>
      i.kind === 'per_koma' &&
      coversGrade(i, grade) &&
      i.ratio === ratio &&
      (duration == null || i.duration_minutes === duration)
  );
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) =>
    (b.duration_minutes ?? 0) > (a.duration_minutes ?? 0) ? b : a
  );
  return best.amount;
}

/** 個別の月謝を引く（学年×形態×分数×週回数） */
export function lookupMonthly(
  items: PricePlanItem[],
  grade: number,
  ratio: PriceRatio,
  duration: number,
  weeklyCount: number
): number | null {
  const found = items.find(
    (i) =>
      i.kind === 'monthly' &&
      coversGrade(i, grade) &&
      i.ratio === ratio &&
      i.duration_minutes === duration &&
      i.weekly_count === weeklyCount
  );
  return found?.amount ?? null;
}

/** 小集団の月謝を引く（学年×科目数）。set=true で特別セット料金 */
export function lookupGroupMonthly(
  items: PricePlanItem[],
  grade: number,
  subjectCount: number,
  set = false
): number | null {
  const kind: PriceItemKind = set ? 'group_set' : 'group_monthly';
  const found = items.find(
    (i) => i.kind === kind && coversGrade(i, grade) && i.subject_count === subjectCount
  );
  return found?.amount ?? null;
}

/** 通年講座（HAL・YSG）の月額を引く。variant は講座名（'HAL50分' など） */
export function lookupCourseMonthly(items: PricePlanItem[], variant: string): number | null {
  const found = items.find((i) => i.kind === 'course_monthly' && i.variant === variant);
  return found?.amount ?? null;
}

/**
 * 増コマ申込フォームの単価表（学年ラベル → 単価）を料金表から組み立てる。
 * 期間を新しく作るときの既定値に使う。保存後はその期間のスナップショットが正典になる。
 * 形態は 1対2（PS2）を既定にする（増コマの単価表に形態の軸が無いため）。
 */
export function buildZoukomaPriceTable(
  items: PricePlanItem[],
  grades: Array<{ label: string; grade: number }>,
  ratio: PriceRatio = 2
): Record<string, number> {
  const table: Record<string, number> = {};
  for (const { label, grade } of grades) {
    const price = lookupPerKoma(items, grade, ratio);
    if (price != null) table[label] = price;
  }
  return table;
}
