/**
 * 成績表の根拠から、講習提案書の単元とコマの下書きを組む規則。
 * 正典: docs/score-sheet-plan-draft.md §5
 *
 * ★ここは AI を使わない。同じ成績表からは毎回同じ下書きになること、
 *   画面で「なぜこうなったか」を説明できることを優先する（決定3・12）。
 * ★出力の形は提案書エディタの UnitDraft に合わせる。とくに結合（group_id）は
 *   いまの「グループ化」（unitDraftLogic.groupSelectedUnits）と同じ約束を守る：
 *   - 束ねるのは隣り合う単元だけ
 *   - 束ねた単元もそれぞれ koma_count ≥ 1 を持ち、合計は先頭の単元だけで数える
 *   これを破ると、保存したあと編集画面で開いたときに壊れる。
 */

import type { DraftUnit, Evidence, PlanUnit, ScoreSubject } from './types';

/** 第1志望の合格基準偏差値がこれ以上なら上位校の組み合わせ（決定11・16。自校作成校は対象外） */
export const UPPER_BASE_SS = 60;
/** 計算の範囲は、この単元数で1コマ（決定5「数学は軽く」） */
export const CALC_UNITS_PER_KOMA = 3;
/** 中2の2教科あわせた目安（表示だけ。決定4） */
export const TARGET_KOMA_G2: [number, number] = [27, 33];

export type IntentTag = '苦手克服' | '苦手補強' | '定着' | '直前演習' | '応用発展';

/** 単元ごとの根拠。PCS で●だった単元は goodPcs に入れる（食い違いの注記に使う） */
export interface UnitEvidence {
  evidence: Map<number, Evidence[]>; // key = units の添字
  goodPcs?: Map<number, string>; // key = units の添字 → PCS の単元名
}

const chapterOf = (no: string | null) => (no && no.includes('-') ? no.split('-')[0] : null);

function tagOf(ev: Evidence[]): IntentTag {
  if (ev.some((e) => e.src === 'pcs' && e.mark === '×')) return '苦手克服';
  if (ev.length > 0 && ev.every((e) => e.hard)) return '応用発展';
  return '苦手補強';
}

/** reason に入れる根拠の文字列。★保護者には出ない列（画面にも印刷にも出ていない）なので、事実をそのまま書く */
export function reasonText(ev: Evidence[], note?: string): string {
  const parts = ev.map((e) => `${e.srcLabel} ${e.label} ${e.mark}${e.hard ? '（難問）' : ''}`);
  if (note) parts.push(note);
  return parts.join('／');
}

interface Row {
  idx: number;
  unit: PlanUnit;
  ev: Evidence[] | null;
  koma: number;
  group: number; // 0 = 束ねない
  head: boolean;
  tag: IntentTag | null;
  reason: string;
}

/** 組んだ行を UnitDraft の形にする（コマが付いた行と、束ねた行だけ） */
function toDrafts(rows: Row[]): DraftUnit[] {
  const renumber = new Map<number, number>();
  const out: DraftUnit[] = [];
  for (const r of rows) {
    if (r.koma <= 0) continue;
    let gid = 0;
    if (r.group > 0) {
      if (!renumber.has(r.group)) renumber.set(r.group, renumber.size + 1);
      gid = renumber.get(r.group)!;
    }
    out.push({
      curriculum_item_id: r.unit.id,
      koma_count: r.koma,
      group_id: gid,
      intent_tag: r.tag,
      reason: r.reason,
    });
  }
  return out;
}

/** 提案書の数え方でコマの合計（結合したまとまりは先頭1件だけ） */
export function draftKoma(drafts: DraftUnit[]): number {
  const seen = new Set<number>();
  let total = 0;
  for (const d of drafts) {
    if (d.group_id > 0) {
      if (seen.has(d.group_id)) continue;
      seen.add(d.group_id);
    }
    total += d.koma_count;
  }
  return total;
}

function conflictNote(idx: number, ev: Evidence[], good?: Map<number, string>): string | undefined {
  const g = good?.get(idx);
  // PCS では●なのに、模試では×だった単元。どちらを採るかは教室長が決める
  if (g && ev.every((e) => e.src === 'mock')) return `食い違い：PCSは「${g}」●`;
  return undefined;
}

/**
 * 数学（軽く）：
 *  ① 計算の範囲は、章の中で隣り合う弱点の単元を束ねて ceil(単元数÷3) コマ
 *  ② それ以外は1単元1コマ。隣り合う単元で根拠（出どころ）が同じなら束ねて1コマ
 *  ③ メリハリ：計算以外で「PCSの×と模試の×が両方」ある単元は2コマ（束ねない）
 */
export function planMath(
  units: PlanUnit[],
  input: UnitEvidence,
  calcRange: { chapters: string[]; extra: string[] }
): DraftUnit[] {
  const isCalc = (u: PlanUnit) =>
    (chapterOf(u.no) != null && calcRange.chapters.includes(chapterOf(u.no)!)) ||
    (u.no != null && calcRange.extra.includes(u.no));
  const both = (ev: Evidence[] | null) =>
    !!ev && ev.some((e) => e.src === 'pcs' && e.mark === '×') && ev.some((e) => e.src === 'mock');

  const rows: Row[] = units.map((unit, idx) => ({
    idx,
    unit,
    ev: input.evidence.get(idx) ?? null,
    koma: 0,
    group: 0,
    head: true,
    tag: null,
    reason: '',
  }));

  let gid = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.ev || r.koma > 0 || r.group > 0) continue;
    const run = [r];
    for (let j = i + 1; j < rows.length; j++) {
      const n = rows[j];
      if (!n.ev || chapterOf(n.unit.no) !== chapterOf(r.unit.no)) break;
      if (isCalc(r.unit)) {
        if (!isCalc(n.unit)) break;
      } else if (n.ev[0].label !== r.ev[0].label || both(n.ev) || both(r.ev)) {
        break;
      }
      run.push(n);
    }
    const koma = isCalc(r.unit)
      ? Math.ceil(run.length / CALC_UNITS_PER_KOMA)
      : run.length === 1 && both(r.ev)
        ? 2
        : 1;
    const g = run.length > 1 ? ++gid : 0;
    // 束ねた中に1つでも苦手克服があれば、まとまり全体を苦手克服として見せる
    const tag = run.some((x) => tagOf(x.ev!) === '苦手克服') ? '苦手克服' : tagOf(r.ev);
    run.forEach((x, k) => {
      x.group = g;
      x.head = k === 0;
      x.koma = k === 0 ? koma : 1;
      x.tag = tag;
      x.reason = reasonText(x.ev!, conflictNote(x.idx, x.ev!, input.goodPcs));
    });
  }
  return toDrafts(rows);
}

/**
 * 英語（重く）：
 *  ① 1単元1コマ。根拠が2つ以上なら2コマ
 *  ② 章のまとまり（「〜章のまとめ」＝番号の無い行で区切る）の中で、弱い単元にはさまれた単元を「定着」として1コマ
 *  ③ 弱い単元が2つ以上あるまとまりは、その「〜章のまとめ」も「定着」として1コマ
 */
export function planEnglish(units: PlanUnit[], input: UnitEvidence): DraftUnit[] {
  const rows: Row[] = units.map((unit, idx) => {
    const ev = input.evidence.get(idx) ?? null;
    return {
      idx,
      unit,
      ev,
      koma: ev ? Math.min(2, ev.length) : 0,
      group: 0,
      head: true,
      tag: ev ? tagOf(ev) : null,
      reason: ev ? reasonText(ev, conflictNote(idx, ev, input.goodPcs)) : '',
    };
  });

  let start = 0;
  rows.forEach((r, i) => {
    // 番号の無い行＝「〜章のまとめ」。★巻頭の「プレステップ」も番号が無いが、弱点が無ければ何も起きない
    if (r.unit.no) return;
    const block = rows.slice(start, i);
    const hit = block.map((b, k) => (b.ev ? k : -1)).filter((k) => k >= 0);
    if (hit.length >= 2 && /まとめ/.test(r.unit.title)) {
      for (let k = hit[0]; k <= hit[hit.length - 1]; k++) {
        const b = block[k];
        if (!b.ev) Object.assign(b, { koma: 1, tag: '定着', reason: '前後：弱い単元のあいだ' });
      }
      Object.assign(r, {
        koma: 1,
        tag: '定着',
        reason: `前後：弱い単元が${hit.length}つある章のまとめ`,
      });
    }
    start = i + 1;
  });
  return toDrafts(rows);
}

// ─────────────────────────────────────────────
// 中3：講習一覧の都立対策コースに当てる（決定9〜13）
// ─────────────────────────────────────────────

export type CourseTier = 'mid' | 'upper';

/** 第1志望の合格基準偏差値から、中堅校／上位校の組み合わせを決める。読めなければ中堅校 */
export function chooseTier(firstChoiceBaseSs: number | null | undefined): CourseTier {
  return firstChoiceBaseSs != null && firstChoiceBaseSs >= UPPER_BASE_SS ? 'upper' : 'mid';
}

/** コースに入っている1冊（テキストの全単元。コースに無い単元は tplKoma=null） */
export interface CourseBook {
  textbookId: number;
  label: string;
  /** 過去問（弱点に関係なく全部入れる） */
  isKako: boolean;
  units: (PlanUnit & { tplKoma: number | null; tplGroup: number })[];
}

export interface CoursePlanResult {
  books: { textbookId: number; label: string; drafts: DraftUnit[] }[];
  /** 当てる×が1つも無かった冊（0コマの提案書を作らないために外した） */
  droppedBooks: string[];
}

/**
 * コースのまとまりごとに入れる：
 *  - ×が当たった単元を含むまとまりを、まとまりごと入れる。コマはコースの値（基本コマ）
 *  - 同じまとまりに根拠が2つ以上なら＋1
 *  - 難問は自動で2コマにしない（決定13。画面の札で知らせるだけ）
 *  - 過去問はコースどおり全部（決定10）
 * ★コースのまとまりには、間に対象外の単元をはさむものがある（ゴール英語の 2-3・4-1・4-2 など）。
 *   提案書の結合は隣り合う単元だけなので、隣り合う範囲で切り直す。切れた後ろ側は基本1コマ。
 */
export function planCourse(
  books: CourseBook[],
  evidence: Map<number, Map<number, Evidence[]>> // textbookId → 単元の添字 → 根拠
): CoursePlanResult {
  const out: CoursePlanResult = { books: [], droppedBooks: [] };

  for (const book of books) {
    const ev = evidence.get(book.textbookId) ?? new Map<number, Evidence[]>();
    // まとまり（隣り合う範囲で切り直したもの）を作る
    const runs: number[][] = [];
    let current: number[] = [];
    let currentGroup = -1;
    book.units.forEach((u, i) => {
      const inCourse = u.tplKoma != null;
      const sameRun = inCourse && u.tplGroup > 0 && u.tplGroup === currentGroup;
      if (!sameRun && current.length > 0) {
        runs.push(current);
        current = [];
      }
      if (!inCourse) {
        currentGroup = -1;
        return;
      }
      current.push(i);
      currentGroup = u.tplGroup > 0 ? u.tplGroup : -1;
      if (u.tplGroup === 0) {
        runs.push(current);
        current = [];
      }
    });
    if (current.length > 0) runs.push(current);

    const rows: Row[] = book.units.map((unit, idx) => ({
      idx,
      unit,
      ev: ev.get(idx) ?? null,
      koma: 0,
      group: 0,
      head: true,
      tag: null,
      reason: '',
    }));

    let gid = 0;
    for (const run of runs) {
      const runEv = run.flatMap((i) => ev.get(i) ?? []);
      if (!book.isKako && runEv.length === 0) continue;
      const base = book.units[run[0]].tplKoma || 1;
      const koma = book.isKako ? base : base + (runEv.length >= 2 ? 1 : 0);
      const tag: IntentTag = book.isKako ? '直前演習' : tagOf(runEv);
      const g = run.length > 1 ? ++gid : 0;
      run.forEach((i, k) => {
        Object.assign(rows[i], {
          group: g,
          head: k === 0,
          koma: k === 0 ? koma : 1,
          tag,
          // 根拠はまとまりの先頭にまとめて書く（束ねた単元は同じコマなので）
          reason:
            k === 0
              ? book.isKako
                ? '過去問は全員5年度分'
                : reasonText(
                    runEv,
                    runEv.length >= 2 ? `基本${base}コマ＋根拠2つ以上で1` : `基本${base}コマ`
                  )
              : '',
        });
      });
    }

    const drafts = toDrafts(rows);
    if (drafts.length === 0) out.droppedBooks.push(book.label);
    else out.books.push({ textbookId: book.textbookId, label: book.label, drafts });
  }
  return out;
}

/** 教科ごとの表示名（画面用） */
export const PLAN_RULE_TEXT: Record<ScoreSubject, string> = {
  math: '計算の範囲は章ごとに束ねて「単元数÷3」コマ。同じ根拠の隣り合う単元は束ねて1コマ。PCSの×と模試の×が両方ある単元は2コマ。',
  eng: '根拠2つ以上で2コマ。弱い単元にはさまれた単元と、弱い単元が2つ以上ある章の「まとめ」を定着として足す。',
};
