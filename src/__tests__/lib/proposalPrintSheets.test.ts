import { describe, it, expect } from 'vitest';
import { groupProposalsForPrint } from '@/lib/proposals/printSheetGrouping';
import type { SeasonalProposalWithDetails } from '@/types/database';

/** テストに要るところだけ埋めた提案書 */
function p(params: {
  id: string;
  subject?: string | null;
  name?: string;
  season?: string;
  year?: number;
  createdAt?: string;
  studentId?: string;
}): SeasonalProposalWithDetails {
  return {
    id: params.id,
    student_id: params.studentId ?? 'stu-1',
    textbook_id: 1,
    season: params.season ?? 'winter',
    year: params.year ?? 2026,
    created_at: params.createdAt ?? '2026-09-01T00:00:00Z',
    theme: '',
    units: [],
    textbook: { name: params.name ?? 'テキスト', subject: params.subject ?? null },
  } as unknown as SeasonalProposalWithDetails;
}

describe('groupProposalsForPrint', () => {
  it('同じ生徒・期・科目の提案書は1枚にまとまる', () => {
    const sheets = groupProposalsForPrint([
      p({ id: 'a', subject: '英語', name: 'A' }),
      p({ id: 'b', subject: '英語', name: 'B' }),
    ]);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].subject).toBe('英語');
    expect(sheets[0].proposals.map((x) => x.id)).toEqual(['a', 'b']);
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
    expect(sheets.every((s) => s.proposals.length === 1)).toBe(true);
  });

  it('まとまりの中は created_at 昇順（作った順＝進める順）に並ぶ', () => {
    const sheets = groupProposalsForPrint([
      p({ id: 'late', subject: '英語', createdAt: '2026-09-03T00:00:00Z' }),
      p({ id: 'early', subject: '英語', createdAt: '2026-09-01T00:00:00Z' }),
      p({ id: 'mid', subject: '英語', createdAt: '2026-09-02T00:00:00Z' }),
    ]);
    expect(sheets[0].proposals.map((x) => x.id)).toEqual(['early', 'mid', 'late']);
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
});
