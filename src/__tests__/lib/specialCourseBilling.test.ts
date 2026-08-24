/**
 * 特別講座の請求連携（specialCourseBilling.ts）のテスト。
 *
 * 正典: docs/special-courses-plan.md フェーズ2-B
 * ★ 通年講座の受講回数は「planWeeklyEntries（座席表の週次生成と同じ純関数）の結果を絞り込む」
 *   という規約なので、テストも実際に planWeeklyEntries を通して数える。
 *   ここをモックにすると、講習期上書きが請求に効いているかを確認できなくなる。
 */
import { describe, it, expect } from 'vitest';
import {
  planWeeklyEntries,
  type PlanPattern,
  type SpecialCourseOverrideInput,
} from '@/lib/schedule/specialCourseOverride';
import {
  aggregateKoushuAmounts,
  aggregateYearRoundAmounts,
  computeSpecialCourseSplit,
  countMonthlySessions,
  isInMonth,
  monthWeekRange,
  parseBillingPeriodMonth,
  resolveDefaultBillingMonth,
  weekStartsCoveringMonth,
  type SpecialCoursePricing,
} from '@/lib/billing/specialCourseBilling';

const AUG_2026 = { year: 2026, month: 8 };

/** 通年講座（小集団）。単価3,000円 */
const COURSE: SpecialCoursePricing = { id: 'course-1', name: '中3英語ゼミ', unit_price: 3000 };

/** 火曜17:00の枠。2026年8月の火曜は 4/11/18/25 の4回 */
function pattern(over: Partial<PlanPattern> & Pick<PlanPattern, 'id' | 'student_id'>): PlanPattern {
  return {
    day_of_week: 2,
    time_slot_id: 'slot-group-eve',
    teacher_id: 't1',
    subject_ids: ['sub-eng'],
    seat_label: null,
    formation: 'group',
    ratio: 2,
    duration_minutes: null,
    half_position: null,
    effective_from: '2026-04-01',
    effective_until: null,
    special_course_id: 'course-1',
    created_at: '2026-04-01T00:00:00Z',
    time_slot: { id: 'slot-group-eve' },
    ...over,
  };
}

/** 夏期(2026-08-01〜08-31)の上書き入力。session_dates を渡さなければ 8/5 10:00 の1回 */
function overrideInput(
  sessionDates: Array<{ date: string; start_time: string; end_time: string }> = [
    { date: '2026-08-05', start_time: '10:00', end_time: '11:30' },
  ]
): SpecialCourseOverrideInput {
  return {
    courses: [{ id: 'course-1', formation: 'group' }],
    periods: [
      {
        season: 'summer',
        year: 2026,
        schedule_start_date: '2026-08-01',
        schedule_end_date: '2026-08-31',
      },
    ],
    overrides: [
      { course_id: 'course-1', season: 'summer', year: 2026, session_dates: sessionDates },
    ],
    timeSlots: [
      { id: 'slot-group-am', formation: 'group', start_time: '10:00:00' },
      { id: 'slot-group-eve', formation: 'group', start_time: '17:00:00' },
    ],
  };
}

/** 対象月に重なる全週について planWeeklyEntries を回す（本番の集計と同じ手順） */
function planMonth(
  patterns: PlanPattern[],
  override: SpecialCourseOverrideInput | null,
  month = AUG_2026
) {
  return weekStartsCoveringMonth(month).map((weekStartDate) =>
    planWeeklyEntries({ weekStartDate, patterns, withdrawalDates: new Map(), override })
  );
}

describe('対象月の決定', () => {
  it('請求期間名 "YYYY年M月" から対象月を読む', () => {
    expect(parseBillingPeriodMonth('2026年8月')).toEqual({ year: 2026, month: 8 });
    expect(parseBillingPeriodMonth('2026年 12月分')).toEqual({ year: 2026, month: 12 });
    // 全角数字の手入力も拾う
    expect(parseBillingPeriodMonth('２０２６年９月')).toEqual({ year: 2026, month: 9 });
  });

  it('読めない期間名は null（呼び出し側で開始日にフォールバックさせる）', () => {
    expect(parseBillingPeriodMonth('夏期請求')).toBeNull();
    expect(parseBillingPeriodMonth('2026年13月')).toBeNull();
    expect(parseBillingPeriodMonth(null)).toBeNull();
  });

  it('既定の対象月は 期間名 → 開始日 → 今日 の順に決まる', () => {
    expect(resolveDefaultBillingMonth('2026年8月', '2026-07-21')).toEqual({
      year: 2026,
      month: 8,
    });
    expect(resolveDefaultBillingMonth('夏期請求', '2026-07-21')).toEqual({ year: 2026, month: 7 });
    expect(resolveDefaultBillingMonth(null, null, new Date('2026-03-15T00:00:00'))).toEqual({
      year: 2026,
      month: 3,
    });
  });
});

describe('対象月に重なる週', () => {
  it('月初・月末を含む週の月曜まで列挙する（2026年8月は6週）', () => {
    // 2026-08-01 は土曜 → その週の月曜は 07-27。2026-08-31 は月曜。
    expect(weekStartsCoveringMonth(AUG_2026)).toEqual([
      '2026-07-27',
      '2026-08-03',
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
      '2026-08-31',
    ]);
    expect(monthWeekRange(AUG_2026)).toEqual({ from: '2026-07-27', to: '2026-09-06' });
  });

  it('月内判定は前後にはみ出した週の日付を落とす', () => {
    expect(isInMonth('2026-08-01', AUG_2026)).toBe(true);
    expect(isInMonth('2026-07-28', AUG_2026)).toBe(false);
    expect(isInMonth('2026-09-01', AUG_2026)).toBe(false);
  });
});

describe('通年講座の月内受講回数（planWeeklyEntries の結果を数える）', () => {
  it('上書きが無ければ定期の枠どおり（2026年8月の火曜=4回）', () => {
    const counts = countMonthlySessions(
      planMonth([pattern({ id: 'p1', student_id: 's1' })], null),
      AUG_2026
    );
    expect(counts.get('s1')?.get('course-1')).toBe(4);
  });

  it('講座に紐づかない枠は数えない（specialCourseId が無いコマは請求対象外）', () => {
    const counts = countMonthlySessions(
      planMonth([pattern({ id: 'p9', student_id: 's9', special_course_id: null })], null),
      AUG_2026
    );
    expect(counts.size).toBe(0);
  });

  it('講習期の上書きがあれば定期は止まり、上書きの日程だけ数える', () => {
    const counts = countMonthlySessions(
      planMonth([pattern({ id: 'p1', student_id: 's1' })], overrideInput()),
      AUG_2026
    );
    // 8月の火曜4回は抑止され、8/5 の上書き1回だけになる
    expect(counts.get('s1')?.get('course-1')).toBe(1);
  });

  it('上書きが空配列（その期は開催しない）なら月内は0回', () => {
    const counts = countMonthlySessions(
      planMonth([pattern({ id: 'p1', student_id: 's1' })], overrideInput([])),
      AUG_2026
    );
    expect(counts.size).toBe(0);
  });

  it('同じ週を重複して渡しても二重計上しない', () => {
    const weeks = planMonth([pattern({ id: 'p1', student_id: 's1' })], null);
    const counts = countMonthlySessions([...weeks, ...weeks], AUG_2026);
    expect(counts.get('s1')?.get('course-1')).toBe(4);
  });
});

describe('通年講座の金額合算', () => {
  it('単価 × 月内回数を生徒ごとに合計する', () => {
    const counts = countMonthlySessions(
      planMonth(
        [pattern({ id: 'p1', student_id: 's1' }), pattern({ id: 'p2', student_id: 's2' })],
        null
      ),
      AUG_2026
    );
    const result = aggregateYearRoundAmounts(counts, [COURSE]);
    expect(result.amountByStudent.get('s1')).toBe(12000);
    expect(result.amountByStudent.get('s2')).toBe(12000);
    expect(result.missingPriceCourseNames).toEqual([]);
  });

  it('複数講座は講座ごとの単価で合算する', () => {
    const counts = countMonthlySessions(
      planMonth(
        [
          pattern({ id: 'p1', student_id: 's1' }),
          // 水曜・別講座（2026年8月の水曜は 5/12/19/26 の4回）
          pattern({
            id: 'p2',
            student_id: 's1',
            day_of_week: 3,
            special_course_id: 'course-2',
            time_slot_id: 'slot-group-am',
            time_slot: { id: 'slot-group-am' },
          }),
        ],
        null
      ),
      AUG_2026
    );
    const result = aggregateYearRoundAmounts(counts, [
      COURSE,
      { id: 'course-2', name: '中3数学ゼミ', unit_price: 2000 },
    ]);
    expect(result.amountByStudent.get('s1')).toBe(3000 * 4 + 2000 * 4);
  });

  it('単価未設定の講座は計上せず講座名を返す（黙って0円にしない）', () => {
    const counts = countMonthlySessions(
      planMonth([pattern({ id: 'p1', student_id: 's1' })], null),
      AUG_2026
    );
    const result = aggregateYearRoundAmounts(counts, [{ ...COURSE, unit_price: null }]);
    expect(result.amountByStudent.size).toBe(0);
    expect(result.missingPriceCourseNames).toEqual(['中3英語ゼミ']);
  });

  it('一覧に無い講座（無効化済みなど）は無視する', () => {
    const counts = countMonthlySessions(
      planMonth([pattern({ id: 'p1', student_id: 's1' })], null),
      AUG_2026
    );
    const result = aggregateYearRoundAmounts(counts, []);
    expect(result.amountByStudent.size).toBe(0);
    expect(result.missingPriceCourseNames).toEqual([]);
  });
});

describe('講習講座の金額合算', () => {
  const courses: SpecialCoursePricing[] = [
    { id: 'k1', name: '英単語特訓', unit_price: 5000 },
    { id: 'k2', name: '暗記講座', unit_price: null },
  ];

  it('単価 × 申込コマ数を生徒ごとに合計する', () => {
    const result = aggregateKoushuAmounts(
      [
        { student_id: 's1', course_id: 'k1', koma_count: 3 },
        { student_id: 's2', course_id: 'k1', koma_count: 1 },
      ],
      courses
    );
    expect(result.amountByStudent.get('s1')).toBe(15000);
    expect(result.amountByStudent.get('s2')).toBe(5000);
  });

  it('単価未設定の講座はスキップし講座名を返す', () => {
    const result = aggregateKoushuAmounts(
      [{ student_id: 's1', course_id: 'k2', koma_count: 2 }],
      courses
    );
    expect(result.amountByStudent.size).toBe(0);
    expect(result.missingPriceCourseNames).toEqual(['暗記講座']);
  });

  it('コマ数0・course_id なし・対象外講座の申込は数えない', () => {
    const result = aggregateKoushuAmounts(
      [
        { student_id: 's1', course_id: 'k1', koma_count: 0 },
        { student_id: 's2', course_id: null, koma_count: 3 },
        { student_id: 's3', course_id: 'other', koma_count: 3 },
      ],
      courses
    );
    expect(result.amountByStudent.size).toBe(0);
  });
});

describe('計上済み/未計上の内訳（増コマ同期と同じ split 規約）', () => {
  it('初回は全額が未計上', () => {
    expect(computeSpecialCourseSplit(0, 12000)).toEqual({
      charged: 0,
      pending: 12000,
      allCharged: false,
    });
  });

  it('再同期しても計上済みは保持し、増えた差分だけ未計上に出す', () => {
    expect(computeSpecialCourseSplit(12000, 15000)).toEqual({
      charged: 12000,
      pending: 3000,
      allCharged: false,
    });
  });

  it('合計が計上済みを下回ったら計上済みを合計まで切り下げる', () => {
    expect(computeSpecialCourseSplit(12000, 9000)).toEqual({
      charged: 9000,
      pending: 0,
      allCharged: true,
    });
  });
});
