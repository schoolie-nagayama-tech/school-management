/**
 * 通塾日程の一覧表（1行=1授業・右に適用期間バー）の純ロジック。
 *
 * 背景:
 *  週マトリクスは「今週の形」しか表せず、「いま社会・10月から理科」のような時間をまたぐ状態が
 *  1画面で読めなかった。1行=1授業にして右に期間バーを引く形に作り直すにあたり、
 *  年度の数え方・バーの位置・出す行の絞り込み・版の鎖のまとめをここに切り出してテストで固定する。
 *
 * 注意:
 *  - 年度は **塾の年度＝3月始まり2月終わり**（4月始まりではない）。2026年度 = 2026-03-01 〜 2027-02-28。
 *  - 日付は 'YYYY-MM-DD' のゼロ埋め固定長なので、比較は辞書順で足りる。
 *  - 状態判定（終了/現在/開始前）は patternVersioning.getPatternPeriodStatus が正典。ここでは作らない。
 *  - DB・React に依存させないこと。
 */

import { getPatternPeriodStatus } from './patternVersioning';

/** 塾の年度の開始月（3月）。4月始まりの学校年度とは違うので定数で明示する。 */
const ACADEMIC_YEAR_START_MONTH = 3;

/** 期間バーの月グリッドの列数（3月〜翌2月の12ヶ月） */
export const ACADEMIC_YEAR_MONTH_COUNT = 12;

/** その年月の日数。2月の閏年もここで吸収する。 */
function daysInMonth(year: number, month: number): number {
  // Date の「翌月0日」＝当月末日
  return new Date(year, month, 0).getDate();
}

/** 'YYYY-MM-DD' を数値の年月日に分解する（不正な文字列は NaN を含む） */
function splitDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-');
  return { y: Number(y), m: Number(m), d: Number(d) };
}

/** 年月日を 'YYYY-MM-DD' に組み立てる */
function joinDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * その日付が属する塾の年度を返す（3月始まり）。
 * 例: 2026-02-28 → 2025年度 / 2026-03-01 → 2026年度
 */
export function getAcademicYear(date: string): number {
  const { y, m } = splitDate(date);
  return m >= ACADEMIC_YEAR_START_MONTH ? y : y - 1;
}

/** 年度の期間。start=その年の3月1日 / end=翌年の2月末日（閏年は2/29）。 */
export function academicYearRange(year: number): { start: string; end: string } {
  const endYear = year + 1;
  return {
    start: joinDate(year, ACADEMIC_YEAR_START_MONTH, 1),
    end: joinDate(endYear, 2, daysInMonth(endYear, 2)),
  };
}

/** 年度に含まれる12ヶ月を 'YYYY-MM' で先頭から並べる（['2026-03', ... , '2027-02']） */
export function academicYearMonths(year: number): string[] {
  const months: string[] = [];
  for (let i = 0; i < ACADEMIC_YEAR_MONTH_COUNT; i++) {
    const monthNumber = ACADEMIC_YEAR_START_MONTH + i;
    const y = year + Math.floor((monthNumber - 1) / 12);
    const m = ((monthNumber - 1) % 12) + 1;
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return months;
}

/**
 * 年度内の位置を 0〜100(%) で返す。
 * 月グリッドなので月の境目がちょうど列の境目に来るよう、月インデックス＋月内の日割りで求める。
 * @param dayOffset 0=その日の始まり（開始日に使う） / 1=その日の終わり（終了日に使う。終了日はその日も有効）
 */
function positionPct(date: string, year: number, dayOffset: 0 | 1): number {
  const { y, m, d } = splitDate(date);
  // 年度先頭（3月）からの月インデックス。年をまたぐぶんを12ヶ月で足す。
  const monthIndex = (y - year) * 12 + (m - ACADEMIC_YEAR_START_MONTH);
  const withinMonth = (d - 1 + dayOffset) / daysInMonth(y, m);
  return ((monthIndex + withinMonth) / ACADEMIC_YEAR_MONTH_COUNT) * 100;
}

export interface BarGeometryInput {
  /** 適用開始日 'YYYY-MM-DD' */
  effectiveFrom: string;
  /** 適用終了日 'YYYY-MM-DD'。null は無期限 */
  effectiveUntil: string | null;
  /** 表示中の年度（3月始まり） */
  year: number;
}

export interface BarGeometry {
  /** バーの左端（%） */
  leftPct: number;
  /** バーの幅（%）。0 未満にはしない */
  widthPct: number;
  /** 年度の左端で切れたか（前の年度にも続いている＝◀の示唆） */
  clippedLeft: boolean;
  /** 年度の右端で切れたか（次の年度にも続いている＝▶の示唆） */
  clippedRight: boolean;
}

/**
 * 期間バーの位置を年度内の割合で返す。
 * その年度に一切かからない行は null（表示対象外）。
 * 年度からはみ出す分はクランプし、はみ出したかを clippedLeft / clippedRight で返す。
 */
export function barGeometry(input: BarGeometryInput): BarGeometry | null {
  const { effectiveFrom, effectiveUntil, year } = input;
  if (!effectiveFrom) return null;
  const { start, end } = academicYearRange(year);

  // 年度と重ならない行は出さない（終了日が年度より前 / 開始日が年度より後）
  if (effectiveUntil && effectiveUntil < start) return null;
  if (effectiveFrom > end) return null;

  const clippedLeft = effectiveFrom < start;
  const clippedRight = !effectiveUntil || effectiveUntil > end;

  const leftPct = clippedLeft ? 0 : positionPct(effectiveFrom, year, 0);
  // 終了日はその日も有効なので、右端は「終了日の終わり」に取る
  const rightPct =
    effectiveUntil && effectiveUntil <= end ? positionPct(effectiveUntil, year, 1) : 100;

  return {
    leftPct,
    // effective_until < effective_from の壊れた行で負の幅にしない
    widthPct: Math.max(0, rightPct - leftPct),
    clippedLeft,
    clippedRight,
  };
}

/** 1年前の同じ日。存在しない日（閏日の1年前）は月末に丸める。 */
export function oneYearBefore(date: string): string {
  const { y, m, d } = splitDate(date);
  const prevYear = y - 1;
  return joinDate(prevYear, m, Math.min(d, daysInMonth(prevYear, m)));
}

export interface PlanRowPeriod {
  effective_from: string;
  effective_until: string | null;
}

/**
 * 一覧に出す行を絞る。
 *  - 現在・開始前の行は常に出す
 *  - 終了した行は showEnded のときだけ、しかも **直近1年ぶん**（today の1年前より後に終了したもの）だけ。
 *    ★トグルをオンにしてもそれより古い行は出さない（古い履歴で表が伸びるのを防ぐ運用上の決定）。
 * 境界日は含める（ちょうど1年前に終了した行は残す）。
 */
export function filterPlanRows<T extends PlanRowPeriod>(
  rows: T[],
  today: string,
  opts: { showEnded: boolean }
): T[] {
  const cutoff = oneYearBefore(today);
  return rows.filter((row) => {
    if (getPatternPeriodStatus(row, today) !== 'ended') return true;
    if (!opts.showEnded) return false;
    // 終了扱いなら effective_until は必ず入っているが、欠けている壊れた行は落とさず残す
    return !row.effective_until || row.effective_until >= cutoff;
  });
}

/**
 * 同じキー（曜日×コマ）の版を鎖にまとめる。表で2行目以降に「↳」を付けて縦につなぐため。
 * 鎖の並びは最初に現れた順、鎖の中の並びは渡された順のまま（呼び出し側で並べ替えてから渡す）。
 */
export function groupIntoChains<T>(rows: T[], keyOf: (row: T) => string): T[][] {
  const chains = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const chain = chains.get(key);
    if (chain) {
      chain.push(row);
    } else {
      chains.set(key, [row]);
    }
  }
  // Map の iterator を直接展開しない（tsconfig の target がES5系のため Array.from を使う）
  return Array.from(chains.values());
}
