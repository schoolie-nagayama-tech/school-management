import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildSuppressionIndex,
  isSuppressedOnDate,
  resolveOverrideTimeSlotId,
  resolveOverrideRoster,
  findSessionsWithoutTimeSlot,
  planWeeklyEntries,
  plannedEntryKey,
  weekDaysOf,
  type PlanPattern,
  type SpecialCourseOverrideInput,
} from '@/lib/schedule/specialCourseOverride';

// 2026-08-03 は月曜。週は 08-03〜08-09。
const WEEK_START = '2026-08-03';

const SUMMER_PERIOD = {
  season: 'summer',
  year: 2026,
  schedule_start_date: '2026-08-01',
  schedule_end_date: '2026-08-31',
};

const TIME_SLOTS = [
  // DB の time 型は 'HH:MM:SS' で返る。比較は先頭5文字で行う想定。
  { id: 'slot-group-am', formation: 'group', start_time: '10:00:00' },
  { id: 'slot-group-eve', formation: 'group', start_time: '17:00:00' },
  { id: 'slot-ind-eve', formation: 'individual', start_time: '17:00:00' },
];

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

/** 上書きあり（8/5 10:00 の1回のみ）の標準入力 */
function overrideInput(
  sessionDates: Array<{ date: string; start_time: string; end_time: string }> = [
    { date: '2026-08-05', start_time: '10:00', end_time: '11:30' },
  ]
): SpecialCourseOverrideInput {
  return {
    courses: [{ id: 'course-1', formation: 'group' }],
    periods: [SUMMER_PERIOD],
    overrides: [
      { course_id: 'course-1', season: 'summer', year: 2026, session_dates: sessionDates },
    ],
    timeSlots: TIME_SLOTS,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('weekDaysOf', () => {
  it('月曜起点で7日分の日付と曜日番号を返す', () => {
    const days = weekDaysOf(WEEK_START);
    expect(days.map((d) => d.date)).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
    ]);
    expect(days.map((d) => d.dow)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe('抑止判定（buildSuppressionIndex / isSuppressedOnDate）', () => {
  it('上書き行がある講習期の期間内だけ抑止する', () => {
    const index = buildSuppressionIndex(overrideInput());
    expect(isSuppressedOnDate(index, 'course-1', '2026-08-05')).toBe(true);
    expect(isSuppressedOnDate(index, 'course-1', '2026-08-01')).toBe(true);
    expect(isSuppressedOnDate(index, 'course-1', '2026-08-31')).toBe(true);
    expect(isSuppressedOnDate(index, 'course-1', '2026-07-31')).toBe(false);
    expect(isSuppressedOnDate(index, 'course-1', '2026-09-01')).toBe(false);
  });

  it('session_dates が空配列でも抑止する（その期は開催しない、の意思表示）', () => {
    const index = buildSuppressionIndex(overrideInput([]));
    expect(isSuppressedOnDate(index, 'course-1', '2026-08-05')).toBe(true);
  });

  it('上書き行が無い講座・講座に属さない枠は抑止しない', () => {
    const index = buildSuppressionIndex(overrideInput());
    expect(isSuppressedOnDate(index, 'course-2', '2026-08-05')).toBe(false);
    expect(isSuppressedOnDate(index, null, '2026-08-05')).toBe(false);
  });

  it('対応する講習期が無い上書き行は無視する（期間が引けないので通常生成に倒す）', () => {
    const input = overrideInput();
    input.periods = [];
    const index = buildSuppressionIndex(input);
    expect(isSuppressedOnDate(index, 'course-1', '2026-08-05')).toBe(false);
  });

  it('上書き入力そのものが無ければ何も抑止しない', () => {
    const index = buildSuppressionIndex(null);
    expect(isSuppressedOnDate(index, 'course-1', '2026-08-05')).toBe(false);
  });
});

describe('コマ解決（resolveOverrideTimeSlotId）', () => {
  it('開始時刻の完全一致でコマを引く（DB の HH:MM:SS も HH:MM と一致させる）', () => {
    expect(resolveOverrideTimeSlotId(TIME_SLOTS, 'group', '10:00')).toBe('slot-group-am');
    expect(resolveOverrideTimeSlotId(TIME_SLOTS, 'group', '10:00:00')).toBe('slot-group-am');
  });

  it('形態が違うコマは引かない', () => {
    expect(resolveOverrideTimeSlotId(TIME_SLOTS, 'group', '17:00')).toBe('slot-group-eve');
    expect(resolveOverrideTimeSlotId(TIME_SLOTS, 'f_programming', '17:00')).toBeNull();
  });

  it('近いだけの時刻には寄せない（完全一致のみ）', () => {
    expect(resolveOverrideTimeSlotId(TIME_SLOTS, 'group', '10:05')).toBeNull();
  });
});

describe('findSessionsWithoutTimeSlot', () => {
  it('コマ時間に無い開始時刻の行だけを index つきで返す', () => {
    const result = findSessionsWithoutTimeSlot(
      [
        { date: '2026-08-05', start_time: '10:00', end_time: '11:30' },
        { date: '2026-08-06', start_time: '10:30', end_time: '12:00' },
      ],
      TIME_SLOTS,
      'group'
    );
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(1);
    expect(result[0].session.start_time).toBe('10:30');
  });
});

describe('名簿・講師の解決（resolveOverrideRoster）', () => {
  it('その日に有効な講座の枠だけを、生徒重複を除いて返す', () => {
    const patterns = [
      pattern({ id: 'p1', student_id: 's1' }),
      pattern({ id: 'p2', student_id: 's2' }),
      // 別講座・期間外・終了済みは名簿に入らない
      pattern({ id: 'p3', student_id: 's3', special_course_id: 'course-2' }),
      pattern({ id: 'p4', student_id: 's4', effective_from: '2026-09-01' }),
      pattern({ id: 'p5', student_id: 's5', effective_until: '2026-07-31' }),
    ];
    const roster = resolveOverrideRoster(patterns, 'course-1', '2026-08-05');
    expect(roster.map((p) => p.student_id)).toEqual(['s1', 's2']);
  });

  it('同じ生徒が複数枠を持つ場合は作成日時が最古の枠を採用する（講師を決定的に選ぶ）', () => {
    const patterns = [
      pattern({
        id: 'p-new',
        student_id: 's1',
        teacher_id: 't-new',
        created_at: '2026-06-01T00:00:00Z',
      }),
      pattern({
        id: 'p-old',
        student_id: 's1',
        teacher_id: 't-old',
        created_at: '2026-04-01T00:00:00Z',
      }),
    ];
    const roster = resolveOverrideRoster(patterns, 'course-1', '2026-08-05');
    expect(roster).toHaveLength(1);
    expect(roster[0].teacher_id).toBe('t-old');
  });

  it('created_at が同値なら id 昇順で決着させる（実行のたびに入れ替わらない）', () => {
    const patterns = [
      pattern({ id: 'pB', student_id: 's1', teacher_id: 'tB' }),
      pattern({ id: 'pA', student_id: 's1', teacher_id: 'tA' }),
    ];
    expect(resolveOverrideRoster(patterns, 'course-1', '2026-08-05')[0].teacher_id).toBe('tA');
  });
});

describe('planWeeklyEntries', () => {
  const koushuPattern = pattern({ id: 'p1', student_id: 's1' });
  const koushuPattern2 = pattern({ id: 'p2', student_id: 's2' });
  // 講座に属さない個別の通塾日程（水曜=2026-08-05）
  const individualPattern = pattern({
    id: 'p-ind',
    student_id: 's9',
    day_of_week: 3,
    time_slot_id: 'slot-ind-eve',
    formation: 'individual',
    special_course_id: null,
    time_slot: { id: 'slot-ind-eve' },
  });

  it('上書きが無ければ通塾日程どおり（既存挙動）', () => {
    const planned = planWeeklyEntries({
      weekStartDate: WEEK_START,
      patterns: [koushuPattern, individualPattern],
      withdrawalDates: new Map(),
      override: null,
    });
    expect(planned.map(plannedEntryKey).sort()).toEqual(
      ['2026-08-04-slot-group-eve-s1', '2026-08-05-slot-ind-eve-s9'].sort()
    );
    expect(planned.every((p) => p.source === 'regular' && p.kind === 'regular')).toBe(true);
  });

  it('上書きがある講習期は定期の生成を止め、上書きの日時で講習コマを作る', () => {
    const planned = planWeeklyEntries({
      weekStartDate: WEEK_START,
      patterns: [koushuPattern, koushuPattern2, individualPattern],
      withdrawalDates: new Map(),
      override: overrideInput(),
    });
    // 火曜の定期コマ（s1・s2）は消え、水曜10:00の講習コマに置き換わる。個別は影響を受けない。
    expect(planned.map(plannedEntryKey).sort()).toEqual(
      [
        '2026-08-05-slot-group-am-s1',
        '2026-08-05-slot-group-am-s2',
        '2026-08-05-slot-ind-eve-s9',
      ].sort()
    );
    const overrideEntry = planned.find((p) => p.source === 'override');
    expect(overrideEntry).toMatchObject({
      kind: 'koushu',
      formation: 'group',
      teacherId: 't1',
      subjectIds: ['sub-eng'],
      specialCourseId: 'course-1',
    });
  });

  it('上書きが空配列なら定期も上書きも生成しない（その期は開催しない）', () => {
    const planned = planWeeklyEntries({
      weekStartDate: WEEK_START,
      patterns: [koushuPattern, koushuPattern2],
      withdrawalDates: new Map(),
      override: overrideInput([]),
    });
    expect(planned).toEqual([]);
  });

  it('上書き行が無い講習期は通常どおり生成する（無指定と空配列の区別）', () => {
    const input = overrideInput();
    input.overrides = [];
    const planned = planWeeklyEntries({
      weekStartDate: WEEK_START,
      patterns: [koushuPattern],
      withdrawalDates: new Map(),
      override: input,
    });
    expect(planned.map(plannedEntryKey)).toEqual(['2026-08-04-slot-group-eve-s1']);
  });

  it('コマ時間に一致しない開始時刻の session は生成せず警告する', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const planned = planWeeklyEntries({
      weekStartDate: WEEK_START,
      patterns: [koushuPattern],
      withdrawalDates: new Map(),
      override: overrideInput([{ date: '2026-08-05', start_time: '10:30', end_time: '12:00' }]),
    });
    expect(planned).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('週外の session は対象にしない', () => {
    const planned = planWeeklyEntries({
      weekStartDate: WEEK_START,
      patterns: [koushuPattern],
      withdrawalDates: new Map(),
      override: overrideInput([{ date: '2026-08-12', start_time: '10:00', end_time: '11:30' }]),
    });
    expect(planned).toEqual([]);
  });

  it('退塾予定日以降は上書き分も生成しない', () => {
    const planned = planWeeklyEntries({
      weekStartDate: WEEK_START,
      patterns: [koushuPattern, koushuPattern2],
      withdrawalDates: new Map([['s1', '2026-08-05']]),
      override: overrideInput(),
    });
    expect(planned.map(plannedEntryKey)).toEqual(['2026-08-05-slot-group-am-s2']);
  });

  it('同じ入力なら何度呼んでも同じ順序・同じ内容を返す（生成と同期チェックが別々に呼ぶため）', () => {
    const args = {
      weekStartDate: WEEK_START,
      patterns: [koushuPattern, koushuPattern2, individualPattern],
      withdrawalDates: new Map<string, string>(),
      override: overrideInput(),
    };
    expect(planWeeklyEntries(args)).toEqual(planWeeklyEntries(args));
  });
});

/**
 * ★ 回帰テストの本命（2026-07-13 型のバグ再発防止）
 *
 * 週次生成 (generateWeeklySchedule) と同期チェック (getExpectedEntryDetailsFromPatterns) は
 * 同じ planWeeklyEntries を通す。ここでは両者の呼び出し側の処理を最小限に模して、
 * 「同期チェックが未反映を検知しない ＝ 画面を開くたびの再生成が走らない」ことを固定する。
 */
describe('生成と同期チェックの一致', () => {
  const patterns = [
    pattern({ id: 'p1', student_id: 's1' }),
    pattern({ id: 'p2', student_id: 's2' }),
    pattern({
      id: 'p-ind',
      student_id: 's9',
      day_of_week: 3,
      time_slot_id: 'slot-ind-eve',
      formation: 'individual',
      special_course_id: null,
      time_slot: { id: 'slot-ind-eve' },
    }),
  ];

  /** 生成側: 既に行が埋まっている枠（振替元・単発コマ等）だけ落として INSERT する */
  function simulateGeneration(
    planKeys: string[],
    occupiedKeys: Set<string>
  ): { inserted: string[]; covered: Set<string> } {
    const inserted = planKeys.filter((k) => !occupiedKeys.has(k));
    // 同期チェックの covered は kind・status を問わず「同一 date-slot-student に行があるか」
    return { inserted, covered: new Set([...inserted, ...Array.from(occupiedKeys.values())]) };
  }

  function runScenario(override: SpecialCourseOverrideInput | null, occupied: string[] = []) {
    // 生成側と同期チェック側が、それぞれ独立に同じ入力で計画を組む
    const generationPlan = planWeeklyEntries({
      weekStartDate: WEEK_START,
      patterns,
      withdrawalDates: new Map(),
      override,
    });
    const expectedPlan = planWeeklyEntries({
      weekStartDate: WEEK_START,
      patterns,
      withdrawalDates: new Map(),
      override,
    });
    const expected = new Set(expectedPlan.map(plannedEntryKey));
    const { inserted, covered } = simulateGeneration(
      generationPlan.map(plannedEntryKey),
      new Set(occupied)
    );
    const missing = Array.from(expected).filter((k) => !covered.has(k));
    return { expected, inserted, covered, missing };
  }

  it('上書きなし: 生成直後に未反映が1件も無い', () => {
    const { expected, missing } = runScenario(null);
    expect(expected.size).toBe(3);
    expect(missing).toEqual([]);
  });

  it('上書きあり: 抑止された定期コマを期待しないので未反映が出ない', () => {
    const { expected, missing } = runScenario(overrideInput());
    // 火曜の定期コマは期待集合から消え、水曜10:00の講習コマが入る
    expect(Array.from(expected).sort()).toEqual(
      [
        '2026-08-05-slot-group-am-s1',
        '2026-08-05-slot-group-am-s2',
        '2026-08-05-slot-ind-eve-s9',
      ].sort()
    );
    expect(missing).toEqual([]);
  });

  it('上書きが休講（空配列）でも未反映が出ない', () => {
    const { expected, missing } = runScenario(overrideInput([]));
    expect(Array.from(expected)).toEqual(['2026-08-05-slot-ind-eve-s9']);
    expect(missing).toEqual([]);
  });

  it('既存行が枠を埋めている場合、生成はスキップするが未反映にもならない', () => {
    // 上書きで作るはずのコマに、既に講習コマが手で置かれている状況（＝再生成すると UNIQUE 違反）
    const occupied = ['2026-08-05-slot-group-am-s1'];
    const { inserted, missing } = runScenario(overrideInput(), occupied);
    expect(inserted).not.toContain('2026-08-05-slot-group-am-s1');
    expect(missing).toEqual([]);
  });

  it('2回連続で回しても新規 INSERT はゼロ（冪等・再生成ループが起きない）', () => {
    const first = runScenario(overrideInput());
    const second = runScenario(overrideInput(), Array.from(first.covered.values()));
    expect(second.inserted).toEqual([]);
    expect(second.missing).toEqual([]);
  });
});
