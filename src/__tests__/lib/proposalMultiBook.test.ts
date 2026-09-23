import { describe, it, expect } from 'vitest';
import {
  buildProposalSaveBlockers,
  calcBookKomaSummary,
  formatBookTitles,
  reorderBooks,
  summarizeBookSaves,
} from '@/components/proposals/proposalMultiBook';

describe('calcBookKomaSummary', () => {
  it('冊ごとのコマ数と全冊の合計を返す', () => {
    const summary = calcBookKomaSummary([
      {
        textbookId: 1,
        name: '中2 英語 A',
        units: [
          { group_id: 0, koma_count: 2 },
          { group_id: 0, koma_count: 2 },
        ],
      },
      { textbookId: 2, name: '中2 英語 B', units: [{ group_id: 0, koma_count: 3 }] },
    ]);
    expect(summary.perBook.map((b) => b.koma)).toEqual([4, 3]);
    expect(summary.perBook.map((b) => b.order)).toEqual([1, 2]);
    expect(summary.totalKoma).toBe(7);
    expect(summary.totalUnitCount).toBe(3);
  });

  it('結合したグループは冊ごとに1コマとして数える（1冊のときと同じ数え方）', () => {
    const summary = calcBookKomaSummary([
      {
        textbookId: 1,
        name: 'A',
        units: [
          { group_id: 1, koma_count: 2 },
          { group_id: 1, koma_count: 2 },
          { group_id: 0, koma_count: 1 },
        ],
      },
    ]);
    expect(summary.totalKoma).toBe(3);
  });

  it('冊が無ければ合計は0', () => {
    expect(calcBookKomaSummary([]).totalKoma).toBe(0);
  });
});

describe('buildProposalSaveBlockers', () => {
  it('テーマ未入力は止める', () => {
    const blockers = buildProposalSaveBlockers({
      theme: '   ',
      books: [{ name: 'A', koma: 3 }],
    });
    expect(blockers).toContain('テーマを入力してください');
  });

  it('テキストが1冊も無ければ止める', () => {
    const blockers = buildProposalSaveBlockers({ theme: '復習', books: [] });
    expect(blockers).toEqual(['テキストを選択してください']);
  });

  it('1冊のときはコマ0でも止めない（従来の挙動を変えない）', () => {
    const blockers = buildProposalSaveBlockers({
      theme: '復習',
      books: [{ name: 'A', koma: 0 }],
    });
    expect(blockers).toEqual([]);
  });

  it('2冊以上のときは、コマ数が入っていない冊を書名入りで止める', () => {
    const blockers = buildProposalSaveBlockers({
      theme: '復習',
      books: [
        { name: 'A', koma: 3 },
        { name: 'B', koma: 0 },
      ],
    });
    expect(blockers).toEqual(['「B」にコマ数が入っていません']);
  });
});

describe('summarizeBookSaves', () => {
  it('全部成功したら成功として扱う', () => {
    const s = summarizeBookSaves([
      { textbookId: 1, name: 'A', proposalId: 'p1' },
      { textbookId: 2, name: 'B', proposalId: 'p2' },
    ]);
    expect(s.allSucceeded).toBe(true);
    expect(s.savedProposalIds).toEqual(['p1', 'p2']);
    expect(s.failedNames).toEqual([]);
    expect(s.tone).toBe('success');
    expect(s.message).toContain('2件');
  });

  it('1冊だけの成功は従来の文言', () => {
    const s = summarizeBookSaves([{ textbookId: 1, name: 'A', proposalId: 'p1' }]);
    expect(s.message).toBe('保存しました');
  });

  it('途中で失敗したら、保存できた冊と失敗した冊を分けて返す', () => {
    const s = summarizeBookSaves([
      { textbookId: 1, name: 'A', proposalId: 'p1' },
      { textbookId: 2, name: 'B', proposalId: null },
    ]);
    expect(s.allSucceeded).toBe(false);
    expect(s.savedTextbookIds).toEqual([1]);
    expect(s.failedNames).toEqual(['B']);
    expect(s.tone).toBe('error');
    expect(s.message).toContain('「B」');
  });

  it('全部失敗したら失敗として扱う', () => {
    const s = summarizeBookSaves([{ textbookId: 1, name: 'A', proposalId: null }]);
    expect(s.savedTextbookIds).toEqual([]);
    expect(s.message).toContain('保存に失敗しました');
  });
});

describe('formatBookTitles', () => {
  it('2冊までは書名を並べる', () => {
    expect(formatBookTitles(['A', 'B'])).toBe('A、B');
  });

  it('3冊以上は「ほかn冊」に畳む', () => {
    expect(formatBookTitles(['A', 'B', 'C'])).toBe('A ほか2冊');
  });

  it('空の書名は数に入れない', () => {
    expect(formatBookTitles(['A', '', '  '])).toBe('A');
    expect(formatBookTitles([])).toBe('');
  });
});

describe('reorderBooks', () => {
  // ★タブの並び＝保存する順＝進める順。テンプレの登録順から生徒ごとに入れ替えられるようにした
  it('つかんだ冊を落とした冊の位置へ動かし、間の冊は1つずつずれる', () => {
    expect(reorderBooks([1, 2, 3], 3, 1)).toEqual([3, 1, 2]);
    expect(reorderBooks([1, 2, 3], 1, 3)).toEqual([2, 3, 1]);
    expect(reorderBooks([1, 2, 3], 2, 3)).toEqual([1, 3, 2]);
  });

  it('見つからない冊・同じ位置なら並びを変えない', () => {
    expect(reorderBooks([1, 2], 9, 1)).toEqual([1, 2]);
    expect(reorderBooks([1, 2], 1, 1)).toEqual([1, 2]);
  });
});
