/**
 * 模試（進研テスト・Vもぎ）の個人帳票の、AI が書き写した結果を検める。
 * 正典: docs/score-sheet-plan-draft.md §4.2
 *
 * ★AI の仕事は書き写すだけ。ここで形を検め、領域ごとに検算し、下書きに使ってよい×だけを取り出す。
 *   検算が合わない領域は、人が○×を直すまで下書きに使わない。
 */

import type {
  AreaCheck,
  MockArea,
  MockDocType,
  MockItem,
  MockResult,
  MockSheet,
  ScoreSubject,
} from './types';

/** 全体正答率がこれ未満の×は「難問」（決定8） */
export const HARD_RATE = 20;
/** その教科の偏差値がこれ以上なら、難問も下書きに入れる（決定8） */
export const HARD_SS = 55;

const SUBJECTS: ScoreSubject[] = ['math', 'eng'];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function toResult(v: unknown): MockResult | null {
  if (v === 'o' || v === 'x' || v === 'x_to_double' || v === 'x_to_star') return v;
  const n = num(v);
  return n == null ? null : n;
}

function toItem(v: unknown): MockItem | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const q = str(o.q);
  const content = str(o.content);
  const result = toResult(o.result);
  if (!q || !content || result == null) return null;
  return { q, content, rate: num(o.rate), avg: num(o.avg), result };
}

function toArea(v: unknown): MockArea | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const name = str(o.name);
  if (!name || !Array.isArray(o.items)) return null;
  const items = o.items.map(toItem).filter((i): i is MockItem => i != null);
  if (items.length === 0) return null;
  return { name, ownPct: num(o.own_pct), items };
}

/**
 * AI の返した JSON を検める。形が違えば null（呼び出し側で「読めませんでした」にする）。
 * ★足りない欄は null にするだけで、推測で埋めない。
 */
export function parseMockSheet(raw: unknown): MockSheet | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const docType: MockDocType | null =
    o.doc_type === 'shinken_test' || o.doc_type === 'vmogi_tokyo' ? o.doc_type : null;
  if (!docType) return null;

  const ssRaw = (o.ss ?? {}) as Record<string, unknown>;
  const ss: MockSheet['ss'] = {};
  for (const s of SUBJECTS) {
    const v = num(ssRaw[s]);
    if (v != null) ss[s] = v;
  }

  const fc = o.first_choice as Record<string, unknown> | null | undefined;
  const firstChoice =
    fc && str(fc.name) ? { name: str(fc.name) as string, baseSs: num(fc.base_ss) } : null;

  const subjRaw = (o.subjects ?? {}) as Record<string, unknown>;
  const subjects: MockSheet['subjects'] = {};
  for (const s of SUBJECTS) {
    const areas = Array.isArray(subjRaw[s])
      ? (subjRaw[s] as unknown[]).map(toArea).filter((a): a is MockArea => a != null)
      : [];
    if (areas.length > 0) subjects[s] = areas;
  }
  if (Object.keys(subjects).length === 0) return null;

  return {
    docType,
    examLabel: str(o.exam_label),
    grade: num(o.grade),
    ss,
    firstChoice,
    subjects,
    studentName: str(o.student_name),
  };
}

const isPartial = (i: MockItem) => typeof i.result === 'number';

/**
 * 領域ごとの検算。帳票の本人得点率は「○の数 ÷ 設問数」を四捨五入したものと一致する（実物17領域で確認）。
 * ★×→◎・×→★ は×として数える（帳票の得点率もそう数えている）。
 */
export function checkArea(area: MockArea): AreaCheck {
  if (area.ownPct == null || area.items.some(isPartial)) return { status: 'partial' };
  const ok = area.items.filter((i) => i.result === 'o').length;
  const counted = Math.round((ok / area.items.length) * 100);
  return counted === area.ownPct
    ? { status: 'ok', counted }
    : { status: 'mismatch', counted, printed: area.ownPct };
}

/** 下書きの根拠になる×1問 */
export interface WrongItem {
  subject: ScoreSubject;
  area: string;
  q: string;
  content: string;
  /** 画面と reason に出す記号（「×」「×→◎」「×→★」「0点」） */
  mark: string;
  rate: number | null;
  avg: number | null;
  hard: boolean;
  /** 部分点の設問（検算の対象外。人が確かめる） */
  partial: boolean;
}

const MARK_TEXT: Record<'x' | 'x_to_double' | 'x_to_star', string> = {
  x: '×',
  x_to_double: '×→◎',
  x_to_star: '×→★',
};

/**
 * 下書きに使う×を取り出す。
 * - 検算が合わない領域は使わない（人が直して status が ok になってから）。
 * - 部分点の設問は、本人の得点が平均点未満なら×として扱う。
 * - 難問（全体正答率20%未満）は、その教科の偏差値が55以上のときだけ入れる。外したものは skipped に。
 */
export function pickWrongItems(
  sheet: MockSheet,
  subject: ScoreSubject,
  confirmedAreas: ReadonlySet<string> = new Set()
): { wrong: WrongItem[]; skippedHard: WrongItem[]; unchecked: string[] } {
  const wrong: WrongItem[] = [];
  const skippedHard: WrongItem[] = [];
  const unchecked: string[] = [];
  const ss = sheet.ss[subject];
  const allowHard = ss != null && ss >= HARD_SS;

  for (const area of sheet.subjects[subject] ?? []) {
    const check = checkArea(area);
    if (check.status === 'mismatch' && !confirmedAreas.has(area.name)) {
      unchecked.push(area.name);
      continue;
    }
    for (const item of area.items) {
      let mark: string | null = null;
      if (typeof item.result === 'number') {
        if (item.avg != null && item.result < item.avg) mark = `${item.result}点`;
      } else if (item.result !== 'o') {
        mark = MARK_TEXT[item.result];
      }
      if (!mark) continue;
      const hard = item.rate != null && item.rate < HARD_RATE;
      const w: WrongItem = {
        subject,
        area: area.name,
        q: item.q,
        content: item.content,
        mark,
        rate: item.rate,
        avg: item.avg,
        hard,
        partial: typeof item.result === 'number',
      };
      if (hard && !allowHard) skippedHard.push(w);
      else wrong.push(w);
    }
  }
  return { wrong, skippedHard, unchecked };
}

/** 画面と reason に出す1問の書き方（例「5 問1 空間内の角の大きさ ×→◎」） */
export function wrongItemLabel(w: WrongItem): string {
  return `${w.q} ${w.content}`;
}
