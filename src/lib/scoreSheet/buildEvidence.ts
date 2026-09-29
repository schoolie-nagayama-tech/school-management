/**
 * 読み取った成績表を、教材の単元ごとの根拠（Evidence）にする。
 * 正典: docs/score-sheet-plan-draft.md §5.1
 *
 * - PCS：対応表（コードに持つ）で単元に当てる。△× は根拠、● は食い違いの注記に使う。
 * - 模試：AI が選んだ当てはめ（key → 単元ID）で当てる。設問1問は単元1か所だけ（二重に数えない）。
 * ★どちらも「当てはまる単元が無いもの」を捨てずに返す（画面に一覧で出して、人が決める）。
 */

import type { MapQuestion } from '@/lib/ai/scoreSheet';
import type { WrongItem } from './mockSheet';
import { wrongItemLabel } from './mockSheet';
import { pcsKey } from './pcsParse';
import type { Evidence, MockDocType, PcsReading, PlanUnit } from './types';

export interface UnmappedEvidence {
  srcLabel: string;
  label: string;
  mark: string;
}

export interface EvidenceResult {
  evidence: Map<number, Evidence[]>; // units の添字 → 根拠
  goodPcs: Map<number, string>;
  unmapped: UnmappedEvidence[];
}

export const emptyEvidence = (): EvidenceResult => ({
  evidence: new Map(),
  goodPcs: new Map(),
  unmapped: [],
});

function push(m: Map<number, Evidence[]>, idx: number, e: Evidence) {
  const list = m.get(idx) ?? [];
  list.push(e);
  m.set(idx, list);
}

/** PCS の印を、対応表で教材の単元に当てる */
export function addPcsEvidence(
  out: EvidenceResult,
  reading: PcsReading,
  map: Record<string, string[]>,
  idxByNo: Map<string, number>
): void {
  for (const u of reading.units) {
    if (!u.now) continue;
    const nos = map[pcsKey(u.group, u.unit)];
    const idxs = (nos ?? []).map((no) => idxByNo.get(no)).filter((i): i is number => i != null);
    if (u.now === '●') {
      idxs.forEach((i) => out.goodPcs.set(i, u.unit));
      continue;
    }
    if (idxs.length === 0) {
      out.unmapped.push({ srcLabel: 'PCS', label: u.unit, mark: u.now });
      continue;
    }
    for (const i of idxs)
      push(out.evidence, i, { src: 'pcs', srcLabel: 'PCS', label: u.unit, mark: u.now });
  }
}

export const mockSrcLabel = (docType: MockDocType) =>
  docType === 'vmogi_tokyo' ? 'Vもぎ' : '進研';

/** AI に当てはめを頼むときの設問。key は教科と設問番号（同じ帳票の中で一意） */
export function mockQuestions(wrong: WrongItem[]): MapQuestion[] {
  return wrong.map((w) => ({
    key: `${w.subject}:${w.q}`,
    subject: w.subject === 'math' ? '数学' : '英語',
    area: w.area,
    q: w.q,
    content: w.content,
  }));
}

/** 模試の×を、当てはめ（key → 単元ID）で単元に当てる */
export function addMockEvidence(
  out: EvidenceResult,
  wrong: WrongItem[],
  mapping: Record<string, number | null>,
  units: PlanUnit[],
  docType: MockDocType
): void {
  const srcLabel = mockSrcLabel(docType);
  const idxById = new Map(units.map((u, i) => [u.id, i]));
  for (const w of wrong) {
    const unitId = mapping[`${w.subject}:${w.q}`];
    const idx = unitId != null ? idxById.get(unitId) : undefined;
    const mark =
      w.mark + (w.rate != null ? `（${w.rate}%）` : w.avg != null ? `（平均${w.avg}点）` : '');
    if (idx == null) {
      out.unmapped.push({ srcLabel, label: wrongItemLabel(w), mark });
      continue;
    }
    push(out.evidence, idx, {
      src: 'mock',
      srcLabel,
      label: wrongItemLabel(w),
      mark,
      hard: w.hard,
    });
  }
}

/**
 * 中3：講習コースの冊にまたがって、模試の×を当てる。
 * ★当ててよいのはコースに入っている単元だけ（tplKoma が null の単元には当てない）
 */
export function courseMockEvidence(
  wrong: WrongItem[],
  mapping: Record<string, number | null>,
  books: { textbookId: number; units: (PlanUnit & { tplKoma: number | null })[] }[],
  docType: MockDocType
): { byBook: Map<number, Map<number, Evidence[]>>; unmapped: UnmappedEvidence[] } {
  const srcLabel = mockSrcLabel(docType);
  const where = new Map<number, { textbookId: number; idx: number }>();
  for (const b of books) {
    b.units.forEach((u, idx) => {
      if (u.tplKoma != null) where.set(u.id, { textbookId: b.textbookId, idx });
    });
  }
  const byBook = new Map<number, Map<number, Evidence[]>>();
  const unmapped: UnmappedEvidence[] = [];
  for (const w of wrong) {
    const unitId = mapping[`${w.subject}:${w.q}`];
    const at = unitId != null ? where.get(unitId) : undefined;
    const mark =
      w.mark + (w.rate != null ? `（${w.rate}%）` : w.avg != null ? `（平均${w.avg}点）` : '');
    if (!at) {
      unmapped.push({ srcLabel, label: wrongItemLabel(w), mark });
      continue;
    }
    const m = byBook.get(at.textbookId) ?? new Map<number, Evidence[]>();
    push(m, at.idx, { src: 'mock', srcLabel, label: wrongItemLabel(w), mark, hard: w.hard });
    byBook.set(at.textbookId, m);
  }
  return { byBook, unmapped };
}
