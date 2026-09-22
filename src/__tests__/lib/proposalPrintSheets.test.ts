import { describe, it, expect } from 'vitest';
import {
  groupProposalsForPrint,
  type PrintProposalSource,
} from '@/lib/proposals/printSheetGrouping';
import { buildPrintBook, printTextbookName } from '@/lib/proposals/buildPrintSheets';
import type { CurriculumItem, SeasonalProposalWithDetails } from '@/types/database';

/** テストに要るところだけ埋めた単元マスタ */
function item(id: number, title: string, subject?: string | null): CurriculumItem {
  return { id, title, subject: subject ?? null, sort_order: id } as unknown as CurriculumItem;
}

/** テストに要るところだけ埋めた提案書＋その教材の全単元 */
function p(params: {
  id: string;
  subject?: string | null;
  name?: string;
  season?: string;
  year?: number;
  createdAt?: string;
  studentId?: string;
  items?: CurriculumItem[];
  /** 提案コマを入れた単元（単元ID → コマ数）。既定は全単元1コマ */
  koma?: Record<number, number>;
}): PrintProposalSource {
  const items = params.items ?? [item(1, '単元1')];
  const units = items.map((it) => ({
    curriculum_item_id: it.id,
    koma_count: params.koma ? (params.koma[it.id] ?? 0) : 1,
    applied_koma: null,
    reason: '',
    group_id: 0,
    applied_group_id: 0,
    intent_tag: null,
  }));
  return {
    proposal: {
      id: params.id,
      student_id: params.studentId ?? 'stu-1',
      textbook_id: 1,
      season: params.season ?? 'winter',
      year: params.year ?? 2026,
      created_at: params.createdAt ?? '2026-09-01T00:00:00Z',
      theme: '',
      units,
      textbook: { name: params.name ?? 'テキスト', subject: params.subject ?? null },
    } as unknown as SeasonalProposalWithDetails,
    items,
  };
}

describe('groupProposalsForPrint', () => {
  it('同じ生徒・期・科目の提案書は1枚にまとまる', () => {
    const sheets = groupProposalsForPrint([
      p({ id: 'a', subject: '英語', name: 'A' }),
      p({ id: 'b', subject: '英語', name: 'B' }),
    ]);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].subject).toBe('英語');
    expect(sheets[0].blocks.map((x) => x.proposal.id)).toEqual(['a', 'b']);
  });

  it('科目が違えば別の紙になる', () => {
    const sheets = groupProposalsForPrint([
      p({ id: 'a', subject: '数学', name: 'A' }),
      p({ id: 'b', subject: '英語', name: 'B' }),
    ]);
    expect(sheets).toHaveLength(2);
    // 紙同士の並びは科目順（従来の一括印刷と同じ）
    expect(sheets.map((s) => s.subject)).toEqual(['英語', '数学']);
  });

  it('科目が空の提案書はまとめず、それぞれ単独で1枚になる', () => {
    const sheets = groupProposalsForPrint([
      p({ id: 'a', subject: null, name: 'A' }),
      p({ id: 'b', subject: null, name: 'B' }),
    ]);
    expect(sheets).toHaveLength(2);
    expect(sheets.every((s) => s.blocks.length === 1)).toBe(true);
  });

  it('まとまりの中は created_at 昇順（作った順＝進める順）に並ぶ', () => {
    const sheets = groupProposalsForPrint([
      p({ id: 'late', subject: '英語', createdAt: '2026-09-03T00:00:00Z' }),
      p({ id: 'early', subject: '英語', createdAt: '2026-09-01T00:00:00Z' }),
      p({ id: 'mid', subject: '英語', createdAt: '2026-09-02T00:00:00Z' }),
    ]);
    expect(sheets[0].blocks.map((x) => x.proposal.id)).toEqual(['early', 'mid', 'late']);
  });

  it('シーズンや年が違えば同じ科目でも別の紙になる', () => {
    const sheets = groupProposalsForPrint([
      p({ id: 'a', subject: '英語', season: 'winter', year: 2026 }),
      p({ id: 'b', subject: '英語', season: 'summer', year: 2026 }),
      p({ id: 'c', subject: '英語', season: 'winter', year: 2025 }),
    ]);
    expect(sheets).toHaveLength(3);
  });

  it('生徒が違えば別の紙になる', () => {
    const sheets = groupProposalsForPrint([
      p({ id: 'a', subject: '英語', studentId: 'stu-1' }),
      p({ id: 'b', subject: '英語', studentId: 'stu-2' }),
    ]);
    expect(sheets).toHaveLength(2);
  });

  // ── 過去問（1冊で全科目・科目は単元側） ──

  it('教材の科目が空でも、単元に科目があれば科目ごとの紙に分かれる', () => {
    const sheets = groupProposalsForPrint([
      p({
        id: 'kakomon',
        subject: null,
        name: '都立入試過去問',
        items: [
          item(1, '英語 2022年度', '英語'),
          item(2, '数学 2022年度', '数学'),
          item(3, '国語 2022年度', '国語'),
        ],
      }),
    ]);
    expect(sheets.map((s) => s.subject).sort()).toEqual(['国語', '数学', '英語'].sort());
    // どの紙にも同じ提案書が載るが、載る単元はその科目のぶんだけ
    for (const sheet of sheets) {
      expect(sheet.blocks).toHaveLength(1);
      expect(sheet.blocks[0].items.map((i) => i.title)).toEqual([`${sheet.subject} 2022年度`]);
    }
  });

  it('過去問の英語の単元は、同じ生徒の英語の紙に合流する', () => {
    const sheets = groupProposalsForPrint([
      p({ id: 'eng', subject: '英語', name: '英語テキスト', createdAt: '2026-09-01T00:00:00Z' }),
      p({
        id: 'kakomon',
        subject: null,
        name: '都立入試過去問',
        createdAt: '2026-09-02T00:00:00Z',
        items: [item(1, '英語 2022年度', '英語'), item(2, '数学 2022年度', '数学')],
      }),
    ]);
    const eng = sheets.find((s) => s.subject === '英語')!;
    expect(eng.blocks.map((b) => b.proposal.id)).toEqual(['eng', 'kakomon']);
    const math = sheets.find((s) => s.subject === '数学')!;
    expect(math.blocks.map((b) => b.proposal.id)).toEqual(['kakomon']);
  });

  it('コマが入っていない科目の紙は作らない', () => {
    const sheets = groupProposalsForPrint([
      p({
        id: 'kakomon',
        subject: null,
        name: '都立入試過去問',
        items: [item(1, '英語 2022年度', '英語'), item(2, '数学 2022年度', '数学')],
        koma: { 1: 2, 2: 0 },
      }),
    ]);
    expect(sheets.map((s) => s.subject)).toEqual(['英語']);
  });

  it('単元にも教材にも科目が無ければ、従来どおり単独で1枚（全単元を載せる）', () => {
    const sheets = groupProposalsForPrint([
      p({
        id: 'univ',
        subject: null,
        name: '志望校過去問（大学受験）',
        items: [item(1, '2022年度'), item(2, '2023年度')],
      }),
    ]);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].subject).toBe('');
    expect(sheets[0].blocks[0].items).toHaveLength(2);
  });
});

describe('buildPrintBook', () => {
  it('その科目の単元とコマ数だけを紙に載せる（2枚を足してもコマが倍にならない）', () => {
    const source = p({
      id: 'kakomon',
      subject: null,
      name: '都立入試過去問',
      items: [
        item(1, '英語 2022年度', '英語'),
        item(2, '英語 2023年度', '英語'),
        item(3, '数学 2022年度', '数学'),
      ],
      koma: { 1: 2, 2: 1, 3: 3 },
    });
    const sheets = groupProposalsForPrint([source]);
    const books = sheets.map((s) => buildPrintBook(s.blocks[0], new Map()));
    const eng = books.find((b) => b.textbookName.startsWith('英語'))!;
    const math = books.find((b) => b.textbookName.startsWith('数学'))!;
    expect(eng.totalKoma).toBe(3);
    expect(eng.activeUnits.map((u) => u.curriculum_item_id)).toEqual([1, 2]);
    expect(math.totalKoma).toBe(3);
    expect(math.activeUnits.map((u) => u.curriculum_item_id)).toEqual([3]);
  });

  it('科目つきの普通の教材は従来どおり1冊ぶん（全単元・全コマ）', () => {
    const source = p({
      id: 'eng',
      subject: '英語',
      name: '中2英語A',
      items: [item(1, 'be動詞'), item(2, '一般動詞')],
      koma: { 1: 2, 2: 2 },
    });
    const sheets = groupProposalsForPrint([source]);
    expect(sheets).toHaveLength(1);
    const book = buildPrintBook(sheets[0].blocks[0], new Map());
    expect(book.textbookName).toBe('英語 中2英語A');
    expect(book.totalKoma).toBe(4);
    expect(book.allItems).toHaveLength(2);
  });
});

describe('printTextbookName', () => {
  it('科目が分かれば「科目 教材名」にする（教材の科目が無い過去問も同じ形）', () => {
    const { proposal } = p({ id: 'a', subject: null, name: '都立入試過去問' });
    expect(printTextbookName(proposal, '英語')).toBe('英語 都立入試過去問');
    expect(printTextbookName(proposal, '')).toBe('都立入試過去問');
  });
});
