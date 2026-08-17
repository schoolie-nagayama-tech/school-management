/**
 * 講師の出勤可否「時間帯ベース」判定のテスト。
 *
 * 形態(formation)ごとに schedule_time_slots の slot_number が独立採番されるため、
 * 出勤可否をコマ番号で持つと「同じ1限」が形態間で別時間になり破綻する。
 * そこで実時刻の区間包含で判定する（docs/teacher-availability-time-based-plan.md）。
 *
 * ここが緩むと、居ない時間帯の講師が候補に出る／居るのに満席と誤判定される。
 */
import { describe, it, expect } from 'vitest';
import {
  mergeTimeSlotLabels,
  isIntervalCovered,
  buildDayIntervals,
  isAvailableForInterval,
  availableUserIdsForInterval,
  DEFAULT_BRIDGE_GAP_MINUTES,
  type AvailabilityDayMap,
} from '@/lib/api/teacher-availability';

/** 個別コマの実例（休憩10分をはさむ3コマ） */
const INDIVIDUAL = ['17:00-18:30', '18:40-20:10', '20:20-21:50'];

const period = (over: {
  days?: number[];
  times?: Record<string, string[]>;
  numbers?: Record<string, number[]>;
}) => ({
  available_days_of_week: over.days ?? [1],
  available_time_slots_by_day: over.times ?? {},
  available_slot_numbers_by_day: over.numbers ?? {},
});

describe('mergeTimeSlotLabels', () => {
  it('休憩がギャップ以下の連続コマを1区間にまとめる', () => {
    const merged = mergeTimeSlotLabels(INDIVIDUAL);
    expect(merged).toEqual([{ start: 17 * 60, end: 21 * 60 + 50 }]);
  });

  it('ギャップを超えて離れたコマは別区間のまま', () => {
    // 17:00-18:30 と 19:00-20:00 は30分空くので橋渡ししない
    const merged = mergeTimeSlotLabels(['17:00-18:30', '19:00-20:00']);
    expect(merged).toEqual([
      { start: 17 * 60, end: 18 * 60 + 30 },
      { start: 19 * 60, end: 20 * 60 },
    ]);
  });

  it('ギャップ閾値ちょうどは橋渡しする（15分）', () => {
    const merged = mergeTimeSlotLabels(['17:00-18:00', '18:15-19:00'], DEFAULT_BRIDGE_GAP_MINUTES);
    expect(merged).toEqual([{ start: 17 * 60, end: 19 * 60 }]);
  });

  it('順不同で渡しても開始時刻順にマージされる', () => {
    const merged = mergeTimeSlotLabels(['18:40-20:10', '17:00-18:30']);
    expect(merged).toEqual([{ start: 17 * 60, end: 20 * 60 + 10 }]);
  });

  it('壊れたラベル・逆転した区間は無視する', () => {
    expect(mergeTimeSlotLabels(['', 'abc', '20:00-19:00', '17:00'])).toEqual([]);
  });

  it('秒付き "HH:MM:SS" 表記も解釈できる', () => {
    expect(mergeTimeSlotLabels(['17:00:00-18:30:00'])).toEqual([
      { start: 17 * 60, end: 18 * 60 + 30 },
    ]);
  });
});

describe('isIntervalCovered', () => {
  const merged = mergeTimeSlotLabels(INDIVIDUAL); // 17:00-21:50 の1区間

  it('区間に丸ごと含まれるコマは可', () => {
    // 個別の休憩をまたぐ集団コマ 18:00-19:00 も、在室していれば可
    expect(isIntervalCovered(merged, '18:00', '19:00')).toBe(true);
  });

  it('終了が区間からはみ出すコマは不可', () => {
    expect(isIntervalCovered(merged, '21:00', '22:30')).toBe(false);
  });

  it('開始が区間より前のコマは不可', () => {
    expect(isIntervalCovered(merged, '16:30', '18:00')).toBe(false);
  });

  it('部分的に重なるだけでは可にしない', () => {
    // 18:00-18:30 しか居ない講師が 18:00-19:00 のコマに合致してはいけない
    const partial = mergeTimeSlotLabels(['18:00-18:30']);
    expect(isIntervalCovered(partial, '18:00', '19:00')).toBe(false);
  });
});

describe('buildDayIntervals', () => {
  it('対象外の曜日は null（呼び出し側で不可として扱う）', () => {
    expect(buildDayIntervals(period({ days: [1] }), 2)).toBeNull();
  });

  it('時間帯が空なら null＝その曜日は全時間可', () => {
    expect(buildDayIntervals(period({ days: [1], times: {} }), 1)).toBeNull();
  });

  it('時間帯が入っていればマージ済み区間を返す', () => {
    const p = period({ days: [1], times: { '1': INDIVIDUAL } });
    expect(buildDayIntervals(p, 1)).toEqual([{ start: 17 * 60, end: 21 * 60 + 50 }]);
  });

  it('旧レコード（コマ番号だけ）は resolver で実時刻に復元する', () => {
    const p = period({ days: [1], numbers: { '1': [1, 2] } });
    const resolveSlotNumber = (n: number) => INDIVIDUAL[n - 1];
    expect(buildDayIntervals(p, 1, { resolveSlotNumber })).toEqual([
      { start: 17 * 60, end: 20 * 60 + 10 },
    ]);
  });

  it('resolver が無ければ旧レコードは全時間可に落ちる', () => {
    const p = period({ days: [1], numbers: { '1': [1, 2] } });
    expect(buildDayIntervals(p, 1)).toBeNull();
  });

  it('時間帯が入っていれば旧コマ番号より優先する', () => {
    const p = period({ days: [1], times: { '1': ['09:00-10:00'] }, numbers: { '1': [1, 2, 3] } });
    const resolveSlotNumber = (n: number) => INDIVIDUAL[n - 1];
    expect(buildDayIntervals(p, 1, { resolveSlotNumber })).toEqual([
      { start: 9 * 60, end: 10 * 60 },
    ]);
  });
});

describe('isAvailableForInterval', () => {
  it('曜日が対象外なら時間帯を問わず不可', () => {
    const p = period({ days: [1], times: { '2': INDIVIDUAL } });
    expect(isAvailableForInterval(p, 2, '17:00', '18:30')).toBe(false);
  });

  it('曜日が対象で時間帯未指定なら全時間可', () => {
    const p = period({ days: [3] });
    expect(isAvailableForInterval(p, 3, '09:00', '23:00')).toBe(true);
  });

  it('個別コマ提出の講師が休憩をまたぐ集団コマにも入れる', () => {
    const p = period({ days: [1], times: { '1': INDIVIDUAL } });
    expect(isAvailableForInterval(p, 1, '18:00', '19:00')).toBe(true);
  });

  it('提出していない時間帯のコマには入れない', () => {
    const p = period({ days: [1], times: { '1': ['17:00-18:30'] } });
    expect(isAvailableForInterval(p, 1, '20:20', '21:50')).toBe(false);
  });
});

describe('availableUserIdsForInterval', () => {
  const map: AvailabilityDayMap = {
    byDayOfWeek: new Map([[1, ['full', 'early', 'allday']]]),
    intervalsByDayAndUser: new Map([
      ['1|full', mergeTimeSlotLabels(INDIVIDUAL)],
      ['1|early', mergeTimeSlotLabels(['17:00-18:30'])],
      // null = 時間帯未指定＝全時間可
      ['1|allday', null],
    ]),
    sourcesByUserId: new Map(),
  };

  it('その時間帯に在室している講師だけを返す', () => {
    expect(availableUserIdsForInterval(map, 1, '18:40', '20:10').sort()).toEqual([
      'allday',
      'full',
    ]);
  });

  it('全時間可の講師はどのコマでも含まれる', () => {
    expect(availableUserIdsForInterval(map, 1, '20:20', '21:50').sort()).toEqual([
      'allday',
      'full',
    ]);
  });

  it('その曜日に誰も居なければ空', () => {
    expect(availableUserIdsForInterval(map, 4, '17:00', '18:30')).toEqual([]);
  });

  it('区間情報が未登録の講師は全時間可として扱う', () => {
    const partial: AvailabilityDayMap = {
      byDayOfWeek: new Map([[1, ['unknown']]]),
      intervalsByDayAndUser: new Map(),
      sourcesByUserId: new Map(),
    };
    expect(availableUserIdsForInterval(partial, 1, '17:00', '18:30')).toEqual(['unknown']);
  });
});
