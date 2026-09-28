import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDisciplineMetric,
  buildKoushuMetric,
  buildLastInterviewMetric,
  buildNextLessonMetric,
  buildMockLines,
  buildProgressMetric,
  buildRecentTestMetric,
  buildRegularTestMetric,
  formatSignedDiff,
  koushuTakenThisYear,
  pickNextLesson,
  reachedUnitTitle,
  splitBySeason,
} from '@/components/students/hub/hubStatus';
import { pickLiveTextbookDetails, type KoushuSeasonBucket } from '@/app/interview/interview.shared';
import { formatKoushuEnrollment } from '@/lib/interview/story';
import type { ScheduleEntry } from '@/types/schedule';
import type { AssessmentWithScores, StudentInterview } from '@/types/database';
import type { TextbookProgressData } from '@/app/interview/ProgressPanel';

/* ---------- 次回授業 ---------- */

function entry(
  id: string,
  entry_date: string,
  start: string | null,
  opts: Partial<ScheduleEntry> = {}
): ScheduleEntry {
  return {
    id,
    entry_date,
    status: 'scheduled',
    subject_ids: ['s-math'],
    teacher_id: 't1',
    teacher: { id: 't1', display_name: '田中', email: null },
    time_slot: start
      ? ({ start_time: `${start}:00`, end_time: '23:59:00' } as ScheduleEntry['time_slot'])
      : undefined,
    ...opts,
  } as ScheduleEntry;
}

// 2026-09-28(月) 18:30
const NOW = new Date(2026, 8, 28, 18, 30);
const SUBJECTS = new Map([['s-math', '数学']]);

describe('pickNextLesson', () => {
  it('取消・振替元を除き、振替先は残す', () => {
    const next = pickNextLesson(
      [
        entry('a', '2026-09-29', '19:00', { status: 'cancelled' }),
        entry('b', '2026-09-29', '20:00', { status: 'transferred_out' }),
        entry('c', '2026-09-30', '19:00', { status: 'transferred_in' }),
      ],
      NOW
    );
    expect(next?.id).toBe('c');
  });

  it('今日の授業で開始時刻を過ぎたものは除き、まだのものは残す', () => {
    expect(
      pickNextLesson(
        [entry('past', '2026-09-28', '17:00'), entry('later', '2026-09-28', '19:00')],
        NOW
      )?.id
    ).toBe('later');
    expect(pickNextLesson([entry('past', '2026-09-28', '18:30')], NOW)).toBeNull();
  });

  it('昨日以前は除き、日付→開始時刻の順で最初を選ぶ', () => {
    const next = pickNextLesson(
      [
        entry('y', '2026-09-27', '19:00'),
        entry('late', '2026-10-01', '20:00'),
        entry('early', '2026-10-01', '17:00'),
      ],
      NOW
    );
    expect(next?.id).toBe('early');
  });
});

describe('buildNextLessonMetric', () => {
  it('「9/30(水) 19:00」と「数学・田中」', () => {
    const m = buildNextLessonMetric([entry('c', '2026-09-30', '19:00')], NOW, SUBJECTS, 60);
    expect(m.value).toBe('9/30(水) 19:00');
    expect(m.sub).toEqual(['数学・田中']);
  });

  it('予定が無ければ「—」と理由', () => {
    const m = buildNextLessonMetric([], NOW, SUBJECTS, 60);
    expect(m.value).toBeNull();
    expect(m.sub).toEqual(['60日先まで予定なし']);
  });

  it('担当未決定は「担当未定」', () => {
    const m = buildNextLessonMetric(
      [
        entry('c', '2026-09-30', '19:00', {
          teacher_id: null as unknown as string,
          teacher: undefined,
        }),
      ],
      NOW,
      SUBJECTS,
      60
    );
    expect(m.sub).toEqual(['数学・担当未定']);
  });
});

/* ---------- 直近の定期テスト ---------- */

function test(
  id: string,
  name_code: string,
  exam_date: string | null,
  scores: Record<string, number | null>,
  category: AssessmentWithScores['category'] = 'regular_test'
): AssessmentWithScores {
  return {
    id,
    category,
    name_code,
    exam_date,
    exam_month: null,
    grade: 8,
    scores: Object.entries(scores).map(([subject, value]) => ({ subject, value })),
  } as unknown as AssessmentWithScores;
}

const FULL_A = { english: 70, math: 60, japanese: 65, social: 60, science: 57 }; // 312
const FULL_B = { english: 75, math: 66, japanese: 70, social: 64, science: 60 }; // 335

describe('buildRegularTestMetric', () => {
  it('5科合計と前回比（新しい順で渡す）', () => {
    const m = buildRegularTestMetric([
      test('new', 'term1_final', '2026-07-05', FULL_A),
      test('old', 'term1_mid', '2026-05-20', FULL_B),
    ]);
    expect(m.value).toBe('312');
    expect(m.sub).toEqual(['5科合計・前回比 −23', '2026-07-05 1学期期末']);
    expect(m.tone).toBe('neutral');
  });

  it('実技など5科以外の科目は合計に入れない', () => {
    const m = buildRegularTestMetric([test('new', 'term1_final', null, { ...FULL_A, music: 80 })]);
    expect(m.value).toBe('312');
    // 実施日が無ければ学年で補う。前回が無ければ前回比は出さない
    expect(m.sub).toEqual(['5科合計', '中2 1学期期末']);
  });

  it('5科のうち欠けがあれば合計を出さず「一部未入力」', () => {
    const m = buildRegularTestMetric([
      test('new', 'term1_final', '2026-07-05', { ...FULL_A, science: null }),
      test('old', 'term1_mid', '2026-05-20', FULL_B),
    ]);
    expect(m.value).toBe('一部未入力');
    expect(m.sub[1]).toBe('2026-07-05 1学期期末');
  });

  it('前回に欠けがあれば前回比は出さない', () => {
    const { math: _omit, ...partial } = FULL_B;
    void _omit;
    const m = buildRegularTestMetric([
      test('new', 'term1_final', '2026-07-05', FULL_A),
      test('old', 'term1_mid', '2026-05-20', partial),
    ]);
    expect(m.sub[0]).toBe('5科合計');
  });

  it('定期テストが無ければ「—」（模試・内申は見ない）', () => {
    const m = buildRegularTestMetric([test('m', 'venue', null, FULL_A, 'mock')]);
    expect(m.value).toBeNull();
    expect(m.sub).toEqual(['定期テストの記録なし']);
  });

  it('差の符号', () => {
    expect(formatSignedDiff(-23)).toBe('−23');
    expect(formatSignedDiff(5)).toBe('+5');
    expect(formatSignedDiff(0)).toBe('±0');
  });
});

/* ---------- 前回の面談 ---------- */

function interview(
  id: string,
  interview_date: string,
  interview_type: StudentInterview['interview_type']
): StudentInterview {
  return { id, interview_date, interview_type, is_completed: false } as StudentInterview;
}

describe('buildLastInterviewMetric', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('約束（task）を除いた最新の面談からの経過日数', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 5, 10, 0));
    const m = buildLastInterviewMetric([
      interview('t', '2026-09-01', 'task'),
      interview('p', '2026-06-05', 'parent_interview'),
      interview('s', '2026-04-01', 'student_interview'),
    ]);
    expect(m.value).toBe('92日前');
    expect(m.sub).toEqual(['2026-06-05 保護者面談']);
  });

  it('面談が無ければ「—」（約束だけでも無い扱い）', () => {
    const m = buildLastInterviewMetric([interview('t', '2026-09-01', 'task')]);
    expect(m.value).toBeNull();
    expect(m.sub).toEqual(['記録なし']);
  });
});

/* ---------- 今月の宿題・遅刻 ---------- */

describe('buildDisciplineMetric', () => {
  const today = new Date(2026, 8, 20);

  it('今月分を日単位で数える（同じ日に複数テキストでも1回）', () => {
    const m = buildDisciplineMetric(
      [
        { session_date: '2026-09-02', homework_not_done: true, tardy: false },
        { session_date: '2026-09-02', homework_not_done: true, tardy: true },
        { session_date: '2026-09-09', homework_not_done: true, tardy: false },
        { session_date: '2026-08-30', homework_not_done: true, tardy: true }, // 先月は数えない
      ],
      today
    );
    expect(m.value).toBe('宿題 2回・遅刻 1回');
    expect(m.sub).toEqual(['今月 授業2日']);
  });

  it('今月の授業記録が無ければ「—」', () => {
    const m = buildDisciplineMetric(
      [{ session_date: '2026-08-30', homework_not_done: true, tardy: false }],
      today
    );
    expect(m.value).toBeNull();
    expect(m.sub).toEqual(['今月の授業記録なし']);
  });

  it('記録があって両方0なら「なし」（0回を並べない）', () => {
    const m = buildDisciplineMetric(
      [{ session_date: '2026-09-02', homework_not_done: false, tardy: false }],
      today
    );
    expect(m.value).toBe('なし');
  });
});

/* ---------- 直近のテスト：模試 ---------- */

function mock(
  id: string,
  exam_month: string,
  scores: Record<string, number | null>
): AssessmentWithScores {
  return {
    ...test(id, 'venue', null, scores, 'mock'),
    exam_month,
  } as AssessmentWithScores;
}

describe('buildMockLines', () => {
  it('5科の偏差値と前回比・日付と模試名', () => {
    expect(
      buildMockLines([
        mock('new', '2026-08-01', { hensa_5: 52.1, hensa_3: 55 }),
        mock('old', '2026-06-01', { hensa_5: 54.4 }),
      ])
    ).toEqual(['模試 偏差値52.1（5科）・前回比 −2.3', '2026-08 会場模試']);
  });

  it('5科が無ければ3科と明記する', () => {
    expect(buildMockLines([mock('new', '2026-08-01', { hensa_3: 48 })])).toEqual([
      '模試 偏差値48（3科）',
      '2026-08 会場模試',
    ]);
  });

  it('前回比は同じ種類（5科どうし・3科どうし）の1つ前とだけ比べる', () => {
    const lines = buildMockLines([
      mock('new', '2026-08-01', { hensa_5: 52 }),
      mock('mid', '2026-07-01', { hensa_3: 60 }), // 3科だけ → 5科の前回にしない
      mock('old', '2026-06-01', { hensa_5: 50 }),
    ]);
    expect(lines[0]).toBe('模試 偏差値52（5科）・前回比 +2');
    const noSameKind = buildMockLines([
      mock('a', '2026-08-01', { hensa_5: 52 }),
      mock('b', '2026-06-01', { hensa_3: 50 }),
    ]);
    expect(noSameKind[0]).toBe('模試 偏差値52（5科）');
  });

  it('偏差値が未入力の模試は飛ばす。模試が無ければ行を出さない', () => {
    expect(
      buildMockLines([
        mock('noHensa', '2026-09-01', { english: 60 }),
        mock('old', '2026-06-01', { hensa_5: 50 }),
      ])[1]
    ).toBe('2026-06 会場模試');
    expect(buildMockLines([test('r', 'term1_final', '2026-07-05', FULL_A)])).toEqual([]);
  });

  it('直近のテストは定期テストの下に模試の行を添える。模試が無ければ添えない', () => {
    const withMock = buildRecentTestMetric([
      test('r', 'term1_final', '2026-07-05', FULL_A),
      mock('m', '2026-08-01', { hensa_5: 52.1 }),
    ]);
    expect(withMock.value).toBe('312');
    expect(withMock.secondary).toEqual(['模試 偏差値52.1（5科）', '2026-08 会場模試']);
    const noMock = buildRecentTestMetric([test('r', 'term1_final', '2026-07-05', FULL_A)]);
    expect(noMock.secondary).toBeUndefined();
    // 定期テストが無く模試だけでも、模試の行は出す
    const mockOnly = buildRecentTestMetric([mock('m', '2026-08-01', { hensa_5: 50 })]);
    expect(mockOnly.value).toBeNull();
    expect(mockOnly.sub).toEqual(['定期テストの記録なし']);
    expect(mockOnly.secondary?.[0]).toBe('模試 偏差値50（5科）');
  });
});

/* ---------- 進行表 ---------- */

/** units: [単元名, 授業日の配列]（並びがそのまま sort_order） */
function textbook(
  id: string,
  subject: string,
  units: [string, string[]][],
  sortOrder: number | null = null,
  season: 'spring' | 'summer' | 'winter' | null = null
): TextbookProgressData {
  return {
    textbook: { id, sort_order: sortOrder, season, textbook: { name: `教材${id}`, subject } },
    rows: units.map(([title, dates], i) => ({
      title,
      sort_order: i,
      progress: { lessons: dates.map((d) => ({ lesson_date: d })) },
    })),
  } as unknown as TextbookProgressData;
}

describe('reachedUnitTitle', () => {
  it('1回目を実施した単元のうち、並びで最も先のもの（最後に授業をした単元ではない）', () => {
    // 復習で一次関数に戻っても（9/20）、到達は二次関数のまま
    const tb = textbook('a', 'math', [
      ['一次関数', ['2026-09-01', '2026-09-20']],
      ['二次関数', ['2026-09-10']],
      ['図形', []],
    ]);
    expect(reachedUnitTitle(tb.rows)).toBe('二次関数');
    expect(reachedUnitTitle(textbook('b', 'math', [['x', []]]).rows)).toBeNull();
  });
});

describe('buildProgressMetric', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('科目ごとの LIVE は面談④の pickLiveTextbookDetails と同じ1冊（講習の冊子は混ざらない）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 10, 0));
    const data = [
      textbook('regular', 'math', [['二次関数', ['2026-09-25']]], 0),
      textbook('summer', 'math', [['夏の総復習', ['2026-08-20']]], 1), // 講習の冊子（古い）
      textbook('eng', 'english', [['過去形', ['2026-09-20']]], 2),
    ];
    const m = buildProgressMetric(data);
    expect(pickLiveTextbookDetails(data).map((d) => d.name)).toEqual(['教材regular', '教材eng']);
    expect(m.rows?.map((r) => r.text)).toEqual([
      '数学 教材regular ｜ 二次関数まで',
      '英語 教材eng ｜ 過去形まで',
    ]);
    expect(m.value).toBeNull();
    expect(m.tone).toBe('neutral');
    expect(m.rows?.every((r) => r.tone === 'neutral' && r.note === null)).toBe(true);
  });

  it('停滞（最終指導から14日超）の行だけ黄で「停滞 N日」', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 10, 0));
    const m = buildProgressMetric([
      textbook('a', 'math', [['二次関数', ['2026-09-25']]]),
      textbook('b', 'english', [['過去形', ['2026-09-01']]]), // 27日前 → 停滞
    ]);
    expect(m.rows?.[0]).toEqual({
      text: '数学 教材a ｜ 二次関数まで',
      note: null,
      tone: 'neutral',
    });
    expect(m.rows?.[1]).toEqual({
      text: '英語 教材b ｜ 過去形まで',
      note: '停滞 27日',
      tone: 'warning',
    });
    expect(m.tone).toBe('neutral');
  });

  it('4科目以上は3科目まで出し「ほか N科目」', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 10, 0));
    const m = buildProgressMetric([
      textbook('a', 'math', [['u', ['2026-09-25']]]),
      textbook('b', 'english', [['u', ['2026-09-25']]]),
      textbook('c', 'japanese', [['u', ['2026-09-25']]]),
      textbook('d', 'science', [['u', ['2026-09-25']]]),
      textbook('e', 'social', [['u', ['2026-09-25']]]),
    ]);
    expect(m.rows).toHaveLength(3);
    expect(m.sub).toEqual(['ほか 2科目']);
  });

  it('LIVE が無ければ（授業記録のあるテキストが無ければ）「—」', () => {
    expect(buildProgressMetric([])).toMatchObject({ value: null, sub: ['進行中のテキストなし'] });
    const m = buildProgressMetric([textbook('a', 'math', [['u', []]])]);
    expect(m.value).toBeNull();
    expect(m.rows).toBeUndefined();
    expect(m.sub).toEqual(['進行中のテキストなし']);
  });
  it('講習のテキスト（季節の印あり）は、新しく使っていても LIVE に選ばない', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 10, 0));
    // 講習の冊子のほうが最近使っているが、通常授業のテキストの進み具合を出したい
    const m = buildProgressMetric([
      textbook('regular', 'math', [['二次関数', ['2026-09-10']]], 0),
      textbook('koushu', 'math', [['総復習', ['2026-09-26']]], 1, 'summer'),
    ]);
    expect(m.rows?.map((r) => r.text)).toEqual(['数学 教材regular ｜ 二次関数まで']);
  });

  it('講習のテキストしか無ければ「—」', () => {
    const m = buildProgressMetric([textbook('k', 'math', [['u', ['2026-09-25']]], 0, 'winter')]);
    expect(m.value).toBeNull();
    expect(m.sub).toEqual(['進行中のテキストなし']);
  });
});

describe('splitBySeason', () => {
  it('季節の印で通常と講習に分け、それぞれの並びは保つ', () => {
    const rows = [
      textbook('a', 'math', [], 0),
      textbook('b', 'math', [], 1, 'summer'),
      textbook('c', 'english', [], 2),
      textbook('d', 'english', [], 3, 'winter'),
    ];
    const { regular, seasonal } = splitBySeason(rows);
    expect(regular.map((r) => r.textbook.id)).toEqual(['a', 'c']);
    expect(seasonal.map((r) => r.textbook.id)).toEqual(['b', 'd']);
  });
});

/* ---------- 講習 ---------- */

function bucket(
  year: number,
  season: string,
  status: KoushuSeasonBucket['status'],
  komaBySubject: Record<string, number>
): KoushuSeasonBucket {
  const totalKoma = Object.values(komaBySubject).reduce((a, b) => a + b, 0);
  return { year, season, status, komaBySubject, totalKoma };
}

describe('buildKoushuMetric', () => {
  const buckets = [
    bucket(2026, 'winter', 'draft', { 数学: 10 }), // 提案書の下書き → 受講していない
    bucket(2026, 'summer', 'approved', { 英語: 12, 数学: 4 }),
    bucket(2026, 'spring', 'approved', { 英語: 8, 数学: 4 }),
    bucket(2025, 'winter', 'approved', { 英語: 20 }), // 前年度
  ];

  it('今年度の直近に受講した期を大きく、科目とコマ（計）を下に、それより前の期をさらに下に', () => {
    const m = buildKoushuMetric(buckets, 2026);
    expect(m.value).toBe('2026 夏期講習');
    expect(m.sub).toEqual(['英語 12コマ・数学 4コマ（計16）', '春期 英語 8・数学 4']);
    expect(m.tone).toBe('neutral');
  });

  it('受講した期の決まりは面談の受講の枠（formatKoushuEnrollment）と同じ', () => {
    const hub = koushuTakenThisYear(buckets, 2026).map((b) => b.season);
    // 面談は今期を除くので、どの季節にも当たらない値を渡して全期で比べる
    const interview = formatKoushuEnrollment(buckets, 2026, '');
    expect(hub).toEqual(['spring', 'summer']);
    expect(interview.map((k) => k.season)).toEqual(['春期', '夏期']);
  });

  it('今期でも申込済なら直近として出す', () => {
    const m = buildKoushuMetric(
      [bucket(2026, 'winter', 'approved', { 数学: 6 }), ...buckets.slice(1)],
      2026
    );
    expect(m.value).toBe('2026 冬期講習');
    expect(m.sub).toEqual(['数学 6コマ（計6）', '春期 英語 8・数学 4 ／ 夏期 英語 12・数学 4']);
  });

  it('今年度の受講が無ければ「—」と面談と同じ文言', () => {
    const m = buildKoushuMetric([bucket(2025, 'winter', 'approved', { 英語: 20 })], 2026);
    expect(m.value).toBeNull();
    expect(m.sub).toEqual(['2026年度の受講なし']);
  });
});
