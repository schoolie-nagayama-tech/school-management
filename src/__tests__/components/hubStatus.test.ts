import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDisciplineMetric,
  buildKoushuMetric,
  buildLastInterviewMetric,
  buildNextLessonMetric,
  buildProgressMetric,
  buildRegularTestMetric,
  formatSignedDiff,
  pickNextLesson,
} from '@/components/students/hub/hubStatus';
import type { ScheduleEntry } from '@/types/schedule';
import type { AssessmentWithScores, StudentInterview } from '@/types/database';
import type { TextbookProgressData } from '@/app/interview/ProgressPanel';
import type { StudentKoushuPeriodGroup } from '@/lib/studentKoushuSummary';

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
    expect(m.sub).toEqual(['記録なし']);
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

/* ---------- 進行表 ---------- */

function textbook(id: string, lessonDates: string[]): TextbookProgressData {
  return {
    textbook: { id, textbook: { name: `教材${id}`, subject: '数学' } },
    rows: [{ progress: { lessons: lessonDates.map((d) => ({ lesson_date: d })) } }],
  } as unknown as TextbookProgressData;
}

describe('buildProgressMetric', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('停滞（最終指導から14日超）が1冊以上なら黄', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 10, 0));
    const m = buildProgressMetric([
      textbook('a', ['2026-09-25']),
      textbook('b', ['2026-09-01']), // 27日前 → 停滞
      textbook('c', ['2026-09-20']),
      textbook('d', []), // 指導記録なしは停滞に数えない（進行表と同じ）
    ]);
    expect(m.value).toBe('4冊中 1冊が停滞');
    expect(m.tone).toBe('warning');
  });

  it('停滞が無ければ中立', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 10, 0));
    const m = buildProgressMetric([textbook('a', ['2026-09-25'])]);
    expect(m.value).toBe('1冊中 停滞なし');
    expect(m.tone).toBe('neutral');
  });

  it('管理中のテキストが無ければ「—」', () => {
    const m = buildProgressMetric([]);
    expect(m.value).toBeNull();
    expect(m.sub).toEqual(['管理中のテキストなし']);
  });
});

/* ---------- 講習 ---------- */

function group(
  label: string,
  statuses: ('draft' | 'sent' | 'approved')[],
  enrollments = 0
): StudentKoushuPeriodGroup {
  return {
    key: label,
    season: 'winter',
    year: 2026,
    label,
    proposals: statuses.map((status, i) => ({
      id: `${label}-${i}`,
      textbookName: 't',
      subject: null,
      theme: '',
      status,
      proposedKoma: 1,
      appliedKoma: null,
    })),
    enrollments: Array.from({ length: enrollments }, () => ({
      formation: 'individual',
      komaCount: 1,
      komaBySubject: {},
    })),
    totalProposedKoma: 0,
    totalAppliedKoma: 0,
  } as StudentKoushuPeriodGroup;
}

describe('buildKoushuMetric', () => {
  it('先頭の期（講習欄の一番上）の提案書の状態', () => {
    const m = buildKoushuMetric([
      group('2026 冬期講習', ['draft', 'draft']),
      group('2026 夏期講習', ['approved']),
    ]);
    expect(m.value).toBe('2026 冬期講習');
    expect(m.sub).toEqual(['提案書 下書き']);
  });

  it('状態が混ざれば件数を並べる', () => {
    const m = buildKoushuMetric([group('2026 冬期講習', ['approved', 'draft', 'draft'])]);
    expect(m.sub).toEqual(['提案書 下書き 2・公開 1']);
  });

  it('申込だけの期', () => {
    const m = buildKoushuMetric([group('冬期講習', [], 1)]);
    expect(m.sub).toEqual(['申込のみ（提案書なし）']);
  });

  it('講習の記録が無ければ「—」', () => {
    const m = buildKoushuMetric([]);
    expect(m.value).toBeNull();
    expect(m.sub).toEqual(['記録なし']);
  });
});
