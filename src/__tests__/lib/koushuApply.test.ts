import { describe, it, expect } from 'vitest';
import {
  aggregateProposalsBySubject,
  buildShiftSlotRows,
  calendarWeeks,
  countWeeklyRegularSlots,
  gradeCategoryOf,
  isApplyPublished,
  isDurationAllowedForGrade,
  isDuplicateResubmission,
  isNonNegativeInteger,
  markHeldSessions,
  regularKomaInPeriod,
  remainingSessionCount,
  resolveGradeEndDate,
  sumProposalUnitsKoma,
  type ExistingEnrollmentSnapshot,
} from '@/lib/utils/koushuApplyPure';

describe('gradeCategoryOf', () => {
  it('小1〜小6は elementary', () => {
    expect(gradeCategoryOf(1)).toBe('elementary');
    expect(gradeCategoryOf(6)).toBe('elementary');
  });

  it('中1〜中3は middle', () => {
    expect(gradeCategoryOf(7)).toBe('middle');
    expect(gradeCategoryOf(9)).toBe('middle');
  });

  it('高1〜既卒(10-13)は high', () => {
    expect(gradeCategoryOf(10)).toBe('high');
    expect(gradeCategoryOf(13)).toBe('high');
  });
});

describe('calendarWeeks', () => {
  it('7/21〜9/12（8週）を正しく数える（例: 夏期講習・お盆を含む）', () => {
    expect(calendarWeeks('2026-07-21', '2026-09-12')).toBe(8);
  });

  it('同じ日は1週として数える', () => {
    expect(calendarWeeks('2026-08-01', '2026-08-01')).toBe(1);
  });

  it('端数は切り上げる', () => {
    // 8/1(土)〜8/8(土) は8日間 = 2週(切り上げ)
    expect(calendarWeeks('2026-08-01', '2026-08-08')).toBe(2);
  });

  it('終了日が開始日より前なら0を返す（例外を投げない）', () => {
    expect(calendarWeeks('2026-08-10', '2026-08-01')).toBe(0);
  });
});

describe('resolveGradeEndDate', () => {
  it('学年別終了日が設定されていればそれを使う（決定44）', () => {
    expect(resolveGradeEndDate('2026-09-12', { '7': '2026-08-31' }, 7)).toBe('2026-08-31');
  });

  it('学年別終了日が無ければ共通の終了日にフォールバックする', () => {
    expect(resolveGradeEndDate('2026-09-12', { '7': '2026-08-31' }, 8)).toBe('2026-09-12');
  });

  it('学年別終了日テーブル自体が無くてもフォールバックする', () => {
    expect(resolveGradeEndDate('2026-09-12', null, 8)).toBe('2026-09-12');
  });
});

describe('isApplyPublished', () => {
  const now = new Date('2026-08-05T10:00:00+09:00');

  it('start/end 両方あり現在時刻が範囲内なら公開', () => {
    expect(isApplyPublished('2026-08-01T00:00:00+09:00', '2026-08-31T23:59:59+09:00', now)).toBe(
      true
    );
  });

  it('start が NULL なら非公開（決定29の要）', () => {
    expect(isApplyPublished(null, '2026-08-31T23:59:59+09:00', now)).toBe(false);
  });

  it('end が NULL でも非公開扱いにする（片方だけの緩和はしない）', () => {
    expect(isApplyPublished('2026-08-01T00:00:00+09:00', null, now)).toBe(false);
  });

  it('範囲の前なら非公開', () => {
    expect(isApplyPublished('2026-09-01T00:00:00+09:00', '2026-09-30T00:00:00+09:00', now)).toBe(
      false
    );
  });

  it('範囲の後なら非公開', () => {
    expect(isApplyPublished('2026-07-01T00:00:00+09:00', '2026-07-31T00:00:00+09:00', now)).toBe(
      false
    );
  });
});

describe('sumProposalUnitsKoma', () => {
  it('group_id=0 のユニットはそのまま加算する', () => {
    expect(
      sumProposalUnitsKoma([
        { groupId: 0, komaCount: 3 },
        { groupId: 0, komaCount: 2 },
      ])
    ).toBe(5);
  });

  it('同一 group_id は1回だけ加算する（結合ユニットの二重計上防止）', () => {
    expect(
      sumProposalUnitsKoma([
        { groupId: 1, komaCount: 4 },
        { groupId: 1, komaCount: 4 },
        { groupId: 0, komaCount: 1 },
      ])
    ).toBe(5);
  });

  it('空配列は0', () => {
    expect(sumProposalUnitsKoma([])).toBe(0);
  });
});

describe('aggregateProposalsBySubject', () => {
  it('同一科目の複数教材を1行に合算する（決定34）', () => {
    const result = aggregateProposalsBySubject([
      {
        subjectId: 'math',
        subjectName: '数学',
        textbookName: '教材A',
        theme: 'テーマ1',
        koma: 3,
        ratio: 2,
        duration: 90,
      },
      {
        subjectId: 'math',
        subjectName: '数学',
        textbookName: '教材B',
        theme: null,
        koma: 2,
        ratio: 2,
        duration: 90,
      },
    ]);
    expect(result).toEqual([
      {
        subjectId: 'math',
        subjectName: '数学',
        textbookNames: ['教材A', '教材B'],
        theme: 'テーマ1',
        proposedKoma: 5,
        ratio: 2,
        duration: 90,
      },
    ]);
  });

  it('科目が異なれば別行のまま、出現順を保つ', () => {
    const result = aggregateProposalsBySubject([
      {
        subjectId: 'eng',
        subjectName: '英語',
        textbookName: 'E1',
        theme: null,
        koma: 1,
        ratio: 2,
        duration: 90,
      },
      {
        subjectId: 'math',
        subjectName: '数学',
        textbookName: 'M1',
        theme: null,
        koma: 1,
        ratio: 2,
        duration: 90,
      },
    ]);
    expect(result.map((r) => r.subjectId)).toEqual(['eng', 'math']);
  });

  it('テーマは最初に現れた非空値を採用する', () => {
    const result = aggregateProposalsBySubject([
      {
        subjectId: 'x',
        subjectName: 'X',
        textbookName: 'T1',
        theme: null,
        koma: 1,
        ratio: 2,
        duration: 90,
      },
      {
        subjectId: 'x',
        subjectName: 'X',
        textbookName: 'T2',
        theme: '2周目対策',
        koma: 1,
        ratio: 2,
        duration: 90,
      },
    ]);
    expect(result[0].theme).toBe('2周目対策');
  });
});

describe('countWeeklyRegularSlots / regularKomaInPeriod', () => {
  it('同一(曜日×コマ)は1回として数える', () => {
    expect(
      countWeeklyRegularSlots([
        { dayOfWeek: 2, timeSlotId: 'slot-1' },
        { dayOfWeek: 2, timeSlotId: 'slot-1' },
        { dayOfWeek: 4, timeSlotId: 'slot-2' },
      ])
    ).toBe(2);
  });

  it('週1回×8週=8コマ（仕様書の例と一致）', () => {
    expect(regularKomaInPeriod(1, 8)).toBe(8);
  });

  it('週回数0なら差引コマ数も0', () => {
    expect(regularKomaInPeriod(0, 8)).toBe(0);
  });
});

describe('isDurationAllowedForGrade / isNonNegativeInteger', () => {
  it('90分は誰でも選べる', () => {
    expect(isDurationAllowedForGrade(13, 90)).toBe(true);
  });

  it('45分は小4(grade=4)まで選べる', () => {
    expect(isDurationAllowedForGrade(4, 45)).toBe(true);
  });

  it('45分は小5(grade=5)以上は選べない（決定17）', () => {
    expect(isDurationAllowedForGrade(5, 45)).toBe(false);
  });

  it('0以上の整数のみ許可（上限は設けない＝決定49）', () => {
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isNonNegativeInteger(999)).toBe(true);
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(1.5)).toBe(false);
    expect(isNonNegativeInteger('3')).toBe(false);
  });
});

describe('buildShiftSlotRows', () => {
  it('開講枠の全量ぶん行を作り、×の枠だけ available=false にする（§9-3）', () => {
    const openSlots = [
      { date: '2026-08-01', timeSlot: '10:00-11:30' },
      { date: '2026-08-01', timeSlot: '13:00-14:30' },
      { date: '2026-08-02', timeSlot: '10:00-11:30' },
    ];
    const unavailable = [{ date: '2026-08-01', timeSlot: '13:00-14:30' }];
    expect(buildShiftSlotRows(openSlots, unavailable)).toEqual([
      { shift_date: '2026-08-01', time_slot: '10:00-11:30', available: true },
      { shift_date: '2026-08-01', time_slot: '13:00-14:30', available: false },
      { shift_date: '2026-08-02', time_slot: '10:00-11:30', available: true },
    ]);
  });

  it('×が無い（全○）なら全行 available=true になる（決定23: 確認なしでそのまま通す）', () => {
    const openSlots = [{ date: '2026-08-01', timeSlot: '10:00-11:30' }];
    expect(buildShiftSlotRows(openSlots, [])).toEqual([
      { shift_date: '2026-08-01', time_slot: '10:00-11:30', available: true },
    ]);
  });

  it('開講枠が無ければ空配列を返す', () => {
    expect(buildShiftSlotRows([], [{ date: '2026-08-01', timeSlot: '10:00-11:30' }])).toEqual([]);
  });
});

describe('markHeldSessions / remainingSessionCount', () => {
  const sessions = [
    { date: '2026-07-01', start_time: '10:00', end_time: '11:30' },
    { date: '2026-07-15', start_time: '10:00', end_time: '11:30' },
    { date: '2026-08-01', start_time: '10:00', end_time: '11:30' },
  ];

  it('today より前の回は held=true になる（決定45: 途中参加）', () => {
    const marked = markHeldSessions(sessions, '2026-07-10');
    expect(marked.map((s) => s.held)).toEqual([true, false, false]);
  });

  it('today と同日は開催前扱い（held=false）', () => {
    const marked = markHeldSessions(sessions, '2026-07-01');
    expect(marked[0].held).toBe(false);
  });

  it('remainingSessionCount は未開催の回数を数える', () => {
    const marked = markHeldSessions(sessions, '2026-07-10');
    expect(remainingSessionCount(marked)).toBe(2);
  });
});

describe('isDuplicateResubmission', () => {
  const nowMs = new Date('2026-08-05T12:00:00Z').getTime();
  const recentIso = new Date(nowMs - 60_000).toISOString(); // 1分前
  const oldIso = new Date(nowMs - 20 * 60_000).toISOString(); // 20分前

  it('既存が無ければ false（新規申込なので重複判定は不要）', () => {
    expect(isDuplicateResubmission([], { subjects: [], courses: [] }, nowMs)).toBe(false);
  });

  it('10分以内・同一内容なら true（決定35: 二重クリックの冪等化）', () => {
    const existing: ExistingEnrollmentSnapshot[] = [
      {
        courseId: null,
        createdAt: recentIso,
        komaBySubject: { math: { koma: 3, ratio: 2, duration: 90 } },
      },
    ];
    const request = {
      subjects: [{ subjectId: 'math', koma: 3, ratio: 2 as const, duration: 90 as const }],
      courses: [],
    };
    expect(isDuplicateResubmission(existing, request, nowMs)).toBe(true);
  });

  it('内容が異なれば false（＝呼び出し側は409にする）', () => {
    const existing: ExistingEnrollmentSnapshot[] = [
      {
        courseId: null,
        createdAt: recentIso,
        komaBySubject: { math: { koma: 3, ratio: 2, duration: 90 } },
      },
    ];
    const request = {
      subjects: [{ subjectId: 'math', koma: 5, ratio: 2 as const, duration: 90 as const }],
      courses: [],
    };
    expect(isDuplicateResubmission(existing, request, nowMs)).toBe(false);
  });

  it('10分より前の申込は false（内容が同じでも既申込として扱う）', () => {
    const existing: ExistingEnrollmentSnapshot[] = [
      {
        courseId: null,
        createdAt: oldIso,
        komaBySubject: { math: { koma: 3, ratio: 2, duration: 90 } },
      },
    ];
    const request = {
      subjects: [{ subjectId: 'math', koma: 3, ratio: 2 as const, duration: 90 as const }],
      courses: [],
    };
    expect(isDuplicateResubmission(existing, request, nowMs)).toBe(false);
  });

  it('koma=0の科目はリクエスト側から除外して比較する（保存時に落とされる規約と整合）', () => {
    const existing: ExistingEnrollmentSnapshot[] = [
      {
        courseId: null,
        createdAt: recentIso,
        komaBySubject: { math: { koma: 3, ratio: 2, duration: 90 } },
      },
    ];
    const request = {
      subjects: [
        { subjectId: 'math', koma: 3, ratio: 2 as const, duration: 90 as const },
        { subjectId: 'eng', koma: 0, ratio: 2 as const, duration: 90 as const },
      ],
      courses: [],
    };
    expect(isDuplicateResubmission(existing, request, nowMs)).toBe(true);
  });

  it('コースの集合も一致していないと true にならない', () => {
    const existing: ExistingEnrollmentSnapshot[] = [
      { courseId: 'course-1', createdAt: recentIso, komaBySubject: null },
    ];
    const request = { subjects: [], courses: [{ courseId: 'course-2' }] };
    expect(isDuplicateResubmission(existing, request, nowMs)).toBe(false);
  });

  it('コースの集合が一致していれば true', () => {
    const existing: ExistingEnrollmentSnapshot[] = [
      { courseId: 'course-1', createdAt: recentIso, komaBySubject: null },
    ];
    const request = { subjects: [], courses: [{ courseId: 'course-1' }] };
    expect(isDuplicateResubmission(existing, request, nowMs)).toBe(true);
  });
});
