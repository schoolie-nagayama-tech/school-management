import { describe, it, expect } from 'vitest';
import {
  computeSeatOccupancy,
  canPlaceEntry,
  computeEffectiveTimeRange,
  type SeatEntryInput,
} from '@/lib/utils/seatOccupancy';

// 便利コンストラクタ
const full = (ratio: 1 | 2 = 2): SeatEntryInput => ({ ratio, halfPosition: null });
const firstHalf = (ratio: 1 | 2 = 2): SeatEntryInput => ({ ratio, halfPosition: 'first' });
const secondHalf = (ratio: 1 | 2 = 2): SeatEntryInput => ({ ratio, halfPosition: 'second' });

describe('computeSeatOccupancy', () => {
  it('空きコマ（maxSeats=2）は全席空き', () => {
    const occ = computeSeatOccupancy([], 2);
    expect(occ.effectiveSeatCount).toBe(2);
    expect(occ.usedSeatCount).toBe(0);
    expect(occ.vacancies).toEqual([{ kind: 'full' }, { kind: 'full' }]);
    expect(occ.isFull).toBe(false);
  });

  it('90+90（全コマ2人）は2席使用で満席', () => {
    const occ = computeSeatOccupancy([full(), full()], 2);
    expect(occ.usedSeatCount).toBe(2);
    expect(occ.isFull).toBe(true);
    expect(occ.vacancies).toEqual([]);
  });

  it('45前+45後は1席を共有し、もう1席が丸ごと空く', () => {
    const occ = computeSeatOccupancy([firstHalf(), secondHalf()], 2);
    expect(occ.usedSeatCount).toBe(1);
    expect(occ.isFull).toBe(false);
    // ペア済みの席には空きが出ず、残り1席が full 空き
    expect(occ.vacancies).toEqual([{ kind: 'full' }]);
  });

  it('45前のみ1人 → 同席の後半空き + 別の1席が丸ごと空き', () => {
    const occ = computeSeatOccupancy([firstHalf()], 2);
    expect(occ.usedSeatCount).toBe(1);
    // 同じ席の後半が空き + もう1席 full
    expect(occ.vacancies).toEqual([{ kind: 'second' }, { kind: 'full' }]);
  });

  it('1対1が1名で満席（席数が1に縮む）', () => {
    const occ = computeSeatOccupancy([full(1)], 2);
    expect(occ.effectiveSeatCount).toBe(1);
    expect(occ.usedSeatCount).toBe(1);
    expect(occ.isFull).toBe(true);
    expect(occ.vacancies).toEqual([]);
  });

  it('1対1の45前でも席を専有し満席（後半は空かない）', () => {
    const occ = computeSeatOccupancy([firstHalf(1)], 2);
    expect(occ.effectiveSeatCount).toBe(1);
    expect(occ.isFull).toBe(true);
    expect(occ.vacancies).toEqual([]);
  });

  it('maxSeats=1（1対2禁止校）で全コマ1人 → 満席', () => {
    const occ = computeSeatOccupancy([full()], 1);
    expect(occ.effectiveSeatCount).toBe(1);
    expect(occ.isFull).toBe(true);
  });
});

describe('canPlaceEntry', () => {
  it('空きコマに全コマ(1対2)を追加できる', () => {
    expect(canPlaceEntry([], full(), 2)).toBe(true);
  });

  it('全コマ2人（満席）には追加できない', () => {
    expect(canPlaceEntry([full(), full()], full(), 2)).toBe(false);
  });

  it('45前が居る席の後半には45後を追加できる', () => {
    expect(canPlaceEntry([firstHalf()], secondHalf(), 2)).toBe(true);
  });

  it('1対1の45前に別生徒45後は不可（同一席・排他）', () => {
    expect(canPlaceEntry([firstHalf(1)], secondHalf(), 2)).toBe(false);
  });

  it('1対1を追加できるのは既存が空のときだけ', () => {
    expect(canPlaceEntry([], full(1), 2)).toBe(true);
    expect(canPlaceEntry([full()], full(1), 2)).toBe(false);
  });

  it('既存に1対1が居ればどんな追加も不可', () => {
    expect(canPlaceEntry([full(1)], full(), 2)).toBe(false);
    expect(canPlaceEntry([full(1)], firstHalf(), 2)).toBe(false);
  });

  it('45前が1人だけの状態で、別席への全コマ追加は可能', () => {
    // 席1の後半空き + 席2が丸ごと空き → full 追加OK
    expect(canPlaceEntry([firstHalf()], full(), 2)).toBe(true);
  });

  it('45前が1人だけの状態で、同じ半コマ(前半)は追加不可・反対半(後半)は追加可', () => {
    expect(canPlaceEntry([firstHalf(), full()], firstHalf(), 2)).toBe(false); // 満席（席2はfull占有）
    expect(canPlaceEntry([firstHalf(), full()], secondHalf(), 2)).toBe(true); // 席1後半に入る
  });
});

describe('computeEffectiveTimeRange', () => {
  it('全コマ(half=null)はコマ丸ごと（既存挙動不変）', () => {
    expect(computeEffectiveTimeRange('18:00:00', '19:30:00', null, null)).toEqual({
      start: '18:00:00',
      end: '19:30:00',
    });
  });

  it('duration=45 でも half 未指定なら全コマ扱い', () => {
    expect(computeEffectiveTimeRange('18:00:00', '19:30:00', 45, null)).toEqual({
      start: '18:00:00',
      end: '19:30:00',
    });
  });

  it('前半は コマ開始〜+45分', () => {
    expect(computeEffectiveTimeRange('18:00:00', '19:30:00', 45, 'first')).toEqual({
      start: '18:00:00',
      end: '18:45:00',
    });
  });

  it('後半は コマ終了-45分〜終了', () => {
    expect(computeEffectiveTimeRange('18:00:00', '19:30:00', 45, 'second')).toEqual({
      start: '18:45:00',
      end: '19:30:00',
    });
  });

  it('前半と後半は時間帯が重ならない（順次詰めが正しく判定できる）', () => {
    const a = computeEffectiveTimeRange('18:00:00', '19:30:00', 45, 'first');
    const b = computeEffectiveTimeRange('18:00:00', '19:30:00', 45, 'second');
    // a.end <= b.start なら重ならない
    expect(a.end <= b.start).toBe(true);
  });
});
