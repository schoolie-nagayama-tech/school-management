/**
 * ユニット: 報告書一覧の月グルーピング（§7-4・UIモック セクション1）。
 *
 * ★ タイムゾーンで月がズレないことを主に守る:
 *   lessonDate は 'YYYY-MM-DD' のカレンダー日なので、Date に変換して getMonth() すると
 *   実行環境のTZ次第で月初/月末が隣の月に落ちる。groupReportsByMonth は文字列のまま
 *   切る実装なので、その契約をここで固定する。
 */
import { describe, it, expect } from 'vitest';
import { groupReportsByMonth, type PortalReportListItem } from '@/types/mypage-report';

/** テスト用の最小の一覧アイテム。 */
function item(id: string, lessonDate: string): PortalReportListItem {
  return {
    id,
    studentId: 's1',
    lessonDate,
    subjectNames: [],
    teacherName: null,
    shortTermGoal: null,
    checkTestScore: null,
    checkTestTotal: null,
    checkTestPassed: null,
    homeworkCompletionPct: null,
    isRead: false,
  };
}

describe('groupReportsByMonth', () => {
  it('空配列なら空配列', () => {
    expect(groupReportsByMonth([])).toEqual([]);
  });

  it('月ごとにまとめ、新しい月が先頭に来る', () => {
    const groups = groupReportsByMonth([
      item('a', '2026-06-30'),
      item('b', '2026-07-14'),
      item('c', '2026-07-09'),
    ]);
    expect(groups.map((g) => g.monthKey)).toEqual(['2026-07', '2026-06']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['b', 'c']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['a']);
  });

  it('月内も新しい順に並ぶ（入力順に依存しない）', () => {
    const groups = groupReportsByMonth([
      item('old', '2026-07-01'),
      item('new', '2026-07-31'),
      item('mid', '2026-07-15'),
    ]);
    expect(groups[0].items.map((i) => i.id)).toEqual(['new', 'mid', 'old']);
  });

  it('表示ラベルはゼロ埋めしない日本語表記', () => {
    const groups = groupReportsByMonth([item('a', '2026-07-14'), item('b', '2026-11-02')]);
    expect(groups.map((g) => g.monthLabel)).toEqual(['2026年11月', '2026年7月']);
  });

  it('★ 月末・月初がTZでズレない（1日と月末日が正しい月に入る）', () => {
    const groups = groupReportsByMonth([
      item('firstOfMonth', '2026-07-01'),
      item('lastOfPrev', '2026-06-30'),
    ]);
    expect(groups[0].monthKey).toBe('2026-07');
    expect(groups[0].items.map((i) => i.id)).toEqual(['firstOfMonth']);
    expect(groups[1].monthKey).toBe('2026-06');
    expect(groups[1].items.map((i) => i.id)).toEqual(['lastOfPrev']);
  });

  it('年をまたいでも新しい年が先頭', () => {
    const groups = groupReportsByMonth([item('a', '2025-12-20'), item('b', '2026-01-10')]);
    expect(groups.map((g) => g.monthKey)).toEqual(['2026-01', '2025-12']);
  });
});
