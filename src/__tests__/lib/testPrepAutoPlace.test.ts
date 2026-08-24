/**
 * テスト対策の自動配置（提案づくり）のテスト。
 * 決めごとは lib/schedule/testPrepAutoPlace.ts の冒頭コメント。
 */
import { describe, it, expect } from 'vitest';
import { pickTestPrepPlacements, type AutoPlaceCell } from '@/lib/schedule/testPrepAutoPlace';

const T = (id: string, priority = 0, load = 0) => ({ id, name: `講師${id}`, priority, load });

function cell(
  date: string,
  slotId: string,
  slotNumber: number,
  teachers = [T('a')]
): AutoPlaceCell {
  return { date, slotId, slotNumber, teachers };
}

describe('pickTestPrepPlacements', () => {
  it('必要数が0なら何も提案しない', () => {
    expect(pickTestPrepPlacements([cell('2026-06-01', 's1', 1)], 0)).toEqual({
      picks: [],
      shortfall: 0,
    });
  });

  it('日付の早い順に置く', () => {
    const cells = [cell('2026-06-05', 's1', 1), cell('2026-06-01', 's1', 1)];
    const r = pickTestPrepPlacements(cells, 1);
    expect(r.picks.map((p) => p.date)).toEqual(['2026-06-01']);
  });

  it('まず1日1コマずつ散らす（同じ日に固めない）', () => {
    const cells = [
      cell('2026-06-01', 's1', 1),
      cell('2026-06-01', 's2', 2),
      cell('2026-06-02', 's1', 1),
      cell('2026-06-03', 's1', 1),
    ];
    const r = pickTestPrepPlacements(cells, 3);
    expect(r.picks.map((p) => p.date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    expect(r.shortfall).toBe(0);
  });

  it('空き日数より必要数が多ければ2巡目で同じ日の別コマを使う', () => {
    const cells = [
      cell('2026-06-01', 's1', 1),
      cell('2026-06-01', 's2', 2),
      cell('2026-06-02', 's1', 1),
    ];
    const r = pickTestPrepPlacements(cells, 3);
    expect(r.picks).toHaveLength(3);
    expect(r.shortfall).toBe(0);
    // 1巡目で 6/1・6/2 を取り、2巡目で 6/1 の2コマ目を足す
    expect(r.picks.map((p) => `${p.date}#${p.slotNumber}`)).toEqual([
      '2026-06-01#1',
      '2026-06-02#1',
      '2026-06-01#2',
    ]);
  });

  it('同じマスを2回使わない', () => {
    const r = pickTestPrepPlacements([cell('2026-06-01', 's1', 1)], 3);
    expect(r.picks).toHaveLength(1);
    expect(r.shortfall).toBe(2);
  });

  it('置ききれない数を shortfall で返す（黙って少なく置かない）', () => {
    const r = pickTestPrepPlacements([], 2);
    expect(r).toEqual({ picks: [], shortfall: 2 });
  });

  it('講師が1人もいないマスは使わない', () => {
    const cells = [cell('2026-06-01', 's1', 1, []), cell('2026-06-02', 's1', 1, [T('a')])];
    const r = pickTestPrepPlacements(cells, 1);
    expect(r.picks.map((p) => p.date)).toEqual(['2026-06-02']);
  });

  it('priority の高い講師（いつもの担当）を採る', () => {
    const cells = [cell('2026-06-01', 's1', 1, [T('a', 0), T('b', 10)])];
    expect(pickTestPrepPlacements(cells, 1).picks[0].teacherId).toBe('b');
  });

  it('priority が同じなら抱えている生徒が少ない講師を採る', () => {
    const cells = [cell('2026-06-01', 's1', 1, [T('a', 0, 2), T('b', 0, 1)])];
    expect(pickTestPrepPlacements(cells, 1).picks[0].teacherId).toBe('b');
  });

  it('同じ提案の中で1人の講師に固まらせない', () => {
    // 2日とも同じ2人が候補。1件目でaを使ったら、2件目はbへ回る
    const teachers = () => [T('a', 0, 0), T('b', 0, 0)];
    const cells = [
      cell('2026-06-01', 's1', 1, teachers()),
      cell('2026-06-02', 's1', 1, teachers()),
    ];
    const r = pickTestPrepPlacements(cells, 2);
    expect(new Set(r.picks.map((p) => p.teacherId))).toEqual(new Set(['a', 'b']));
  });

  it('候補が同点でも結果が毎回同じ（並びが安定している）', () => {
    const cells = [cell('2026-06-01', 's1', 1, [T('b'), T('a')])];
    const first = pickTestPrepPlacements(cells, 1);
    const second = pickTestPrepPlacements(cells, 1);
    expect(first).toEqual(second);
    expect(first.picks[0].teacherId).toBe('a');
  });
});
