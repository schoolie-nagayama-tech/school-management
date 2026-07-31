/**
 * 「今使っているテキスト」(LIVE) 判定のテスト。
 *
 * 同一科目に2冊以上あるのは常態（本番実測で約38%）で、取り違えると
 * 別の教材に進捗を書き込む事故になるため、判定条件を固定しておく。
 */
import { describe, it, expect } from 'vitest';
import { pickLiveTextbookIds } from '@/app/students/[studentId]/progress/newProgress.shared';
import type { StudentTextbookWithDetails } from '@/types/database';

/** テスト用の最小テキスト。判定に効くのは id / subject / sort_order / created_at のみ。 */
function tb(
  id: string,
  subject: string,
  sortOrder: number | null,
  createdAt = '2026-01-01'
): StudentTextbookWithDetails {
  return {
    id,
    sort_order: sortOrder,
    created_at: createdAt,
    textbook: { subject },
  } as unknown as StudentTextbookWithDetails;
}

describe('pickLiveTextbookIds', () => {
  it('同じ科目では最終利用日が新しい方を選ぶ', () => {
    const list = [tb('a', '算数', 1), tb('b', '算数', 2)];
    const live = pickLiveTextbookIds(list, { a: '2026-07-01', b: '2026-07-20' });
    expect(Array.from(live)).toEqual(['b']);
  });

  it('手動順が下でも、新しければそちらが LIVE になる', () => {
    // 「一番上で運用」していた頃に取り違えていたケース
    const list = [tb('top', '算数', 1), tb('bottom', '算数', 9)];
    const live = pickLiveTextbookIds(list, { top: '2026-05-01', bottom: '2026-07-30' });
    expect(live.has('bottom')).toBe(true);
    expect(live.has('top')).toBe(false);
  });

  it('科目ごとに1冊ずつ選ぶ', () => {
    const list = [tb('m1', '算数', 1), tb('m2', '算数', 2), tb('j1', '国語', 1)];
    const live = pickLiveTextbookIds(list, {
      m1: '2026-07-10',
      m2: '2026-07-20',
      j1: '2026-06-01',
    });
    expect(live).toEqual(new Set(['m2', 'j1']));
  });

  it('算数と数学は同じ列として扱う（categorizeSubject と揃える）', () => {
    const list = [tb('a', '算数', 1), tb('b', '数学', 2)];
    const live = pickLiveTextbookIds(list, { a: '2026-07-01', b: '2026-07-20' });
    expect(Array.from(live)).toEqual(['b']);
  });

  it('同日なら手動順が上の方を選ぶ（現行運用に合わせる）', () => {
    const list = [tb('upper', '算数', 1), tb('lower', '算数', 2)];
    const live = pickLiveTextbookIds(list, { upper: '2026-07-30', lower: '2026-07-30' });
    expect(Array.from(live)).toEqual(['upper']);
  });

  it('授業記録が無いテキストは候補にしない', () => {
    const list = [tb('a', '算数', 1), tb('b', '算数', 2)];
    const live = pickLiveTextbookIds(list, { b: '2026-07-20' });
    expect(Array.from(live)).toEqual(['b']);
  });

  it('科目内の全冊に記録が無ければ、その科目には LIVE を出さない', () => {
    const list = [tb('a', '算数', 1), tb('b', '算数', 2)];
    expect(pickLiveTextbookIds(list, {}).size).toBe(0);
  });

  it('古い記録しか無くても、その科目で最新なら LIVE にする（期限を設けない）', () => {
    const list = [tb('a', '算数', 1)];
    const live = pickLiveTextbookIds(list, { a: '2020-01-01' });
    expect(Array.from(live)).toEqual(['a']);
  });

  it('sort_order 未設定同士は created_at が古い方を上として扱う', () => {
    const list = [tb('new', '算数', null, '2026-03-01'), tb('old', '算数', null, '2026-01-01')];
    const live = pickLiveTextbookIds(list, { new: '2026-07-30', old: '2026-07-30' });
    expect(Array.from(live)).toEqual(['old']);
  });
});
