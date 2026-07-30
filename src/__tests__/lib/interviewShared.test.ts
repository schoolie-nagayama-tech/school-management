import { describe, it, expect } from 'vitest';
import {
  extractHandover,
  formatKoushuEnrollments,
  formatRegularPatternsSchedule,
  computeScoreSummary,
  summarizeTextbookDetail,
  computeDisciplineMonthly,
  computeDisciplineMonthlyByStudent,
} from '@/app/interview/interview.shared';
import type {
  AssessmentWithScores,
  CurriculumItemWithProgress,
  StudentTextbookWithDetails,
} from '@/types/database';
import type { ScheduleRegularPattern } from '@/types/schedule';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';

describe('extractHandover', () => {
  it('見出し以降〜次の見出しまでを抜き出す', () => {
    const content =
      '## 成績について\n数学が伸びた\n\n## 次回への申し送り\n単語帳の進捗を確認する\n\n## 学校での様子\n部活が忙しい';
    expect(extractHandover(content)).toBe('単語帳の進捗を確認する');
  });

  it('見出しが末尾にある場合は末尾まで抜き出す', () => {
    const content = '## 次回への申し送り\n過去問演習の進捗を確認する';
    expect(extractHandover(content)).toBe('過去問演習の進捗を確認する');
  });

  it('見出しが無ければ null を返す', () => {
    expect(extractHandover('雑談のみで特にメモなし')).toBeNull();
  });

  it('見出しはあるが本文が空なら null を返す（呼び出し側でフォールバックさせる）', () => {
    expect(extractHandover('## 次回への申し送り\n\n## 学校での様子\n部活')).toBeNull();
  });
});

describe('formatRegularPatternsSchedule', () => {
  it('曜日昇順・重複除去して整形する', () => {
    const patterns = [
      {
        day_of_week: 4,
        time_slot: { start_time: '19:00:00', slot_number: 3 },
      },
      {
        day_of_week: 2,
        time_slot: { start_time: '19:00:00', slot_number: 3 },
      },
    ] as unknown as ScheduleRegularPattern[];
    expect(formatRegularPatternsSchedule(patterns)).toBe('火19:00 / 木19:00');
  });

  it('0件なら未設定を返す', () => {
    expect(formatRegularPatternsSchedule([])).toBe('未設定');
  });
});

describe('formatKoushuEnrollments', () => {
  it('季節ごとに合算する', () => {
    const enrollments = [
      { season: 'summer', koma_count: 10 },
      { season: 'summer', koma_count: 6 },
      { season: 'winter', koma_count: 8 },
    ] as unknown as KoushuEnrollment[];
    expect(formatKoushuEnrollments(enrollments)).toBe('夏期: 16コマ、冬期: 8コマ');
  });

  it('0件なら申込なしを返す', () => {
    expect(formatKoushuEnrollments([])).toBe('申込なし');
  });
});

describe('computeScoreSummary', () => {
  it('直近3件を古い→新しい順に並べ替え、合計点を算出する', () => {
    const assessments = [
      {
        category: 'regular_test',
        name_code: 'term2_final',
        scores: [
          { subject: 'english', value: 80 },
          { subject: 'math', value: 70 },
        ],
      },
      {
        category: 'regular_test',
        name_code: 'term1_final',
        scores: [
          { subject: 'english', value: 60 },
          { subject: 'math', value: 50 },
        ],
      },
      // 定期テスト以外は除外される
      { category: 'mock', name_code: 'venue', scores: [{ subject: 'english', value: 99 }] },
    ] as unknown as AssessmentWithScores[];

    const summary = computeScoreSummary(assessments);
    // listAssessments は新しい順で返るため、先頭2件（term2_final, term1_final）を反転して
    // [term1_final, term2_final] の古い→新しい順になる
    expect(summary.testLabels).toEqual(['1学期期末', '2学期期末']);
    const englishRow = summary.rows.find((r) => r.subject === 'english');
    expect(englishRow?.values).toEqual([60, 80]);
    expect(summary.totals).toEqual([110, 150]);
  });

  it('成績が無ければ空配列を返す', () => {
    expect(computeScoreSummary([]).testLabels).toEqual([]);
  });

  it('カテゴリ・件数を指定できる（内申は科目集合が定期テストと異なるため実データから科目行を作る）', () => {
    const assessments = [
      {
        category: 'report_card',
        name_code: 'term2',
        scores: [
          { subject: 'music', value: 4 },
          { subject: 'art', value: 5 },
        ],
      },
      {
        category: 'report_card',
        name_code: 'term1',
        scores: [
          { subject: 'music', value: 3 },
          { subject: 'art', value: 4 },
        ],
      },
      // 定期テストは対象外カテゴリなので混ざらない
      {
        category: 'regular_test',
        name_code: 'term1_final',
        scores: [{ subject: 'english', value: 90 }],
      },
    ] as unknown as AssessmentWithScores[];

    const summary = computeScoreSummary(assessments, 'report_card', 5);
    expect(summary.testLabels).toEqual(['1学期', '2学期']);
    // english は report_card の scores に出現しないため行に含まれない（固定5科ではなく実データ由来）
    expect(summary.rows.map((r) => r.subject)).toEqual(['music', 'art']);
    expect(summary.rows.find((r) => r.subject === 'music')?.values).toEqual([3, 4]);
  });
});

describe('summarizeTextbookDetail', () => {
  const textbook = {
    id: 'st-1',
    textbook: { name: 'システム英単語', subject: '英語' },
  } as unknown as StudentTextbookWithDetails;

  it('直近の単元履歴を実施日の新しい順に並べ、次にやる単元・宿題/遅刻件数を集計する', () => {
    const rows = [
      {
        title: '第1章',
        sort_order: 1,
        progress: {
          teacher_name: '山田',
          handover: '  ',
          homework_not_done: false,
          tardy: false,
          lessons: [{ lesson_date: '2026-07-01', teacher_name: null }],
        },
      },
      {
        title: '第2章',
        sort_order: 2,
        progress: {
          teacher_name: null,
          handover: '単語帳の続きを確認する',
          homework_not_done: true,
          tardy: false,
          lessons: [{ lesson_date: '2026-07-15', teacher_name: '佐藤' }],
        },
      },
      // レッスンが1件も無い = 未実施（次にやる単元の候補）
      { title: '第3章', sort_order: 3, progress: null },
      { title: '第4章', sort_order: 4, progress: null },
    ] as unknown as CurriculumItemWithProgress[];

    const detail = summarizeTextbookDetail(textbook, rows);

    expect(detail.name).toBe('システム英単語');
    expect(detail.total).toBe(4);
    expect(detail.done).toBe(2);
    // 新しい順: 第2章(07/15) → 第1章(07/01)
    expect(detail.recentLessons.map((l) => l.unitTitle)).toEqual(['第2章', '第1章']);
    expect(detail.recentLessons[0].teacherName).toBe('佐藤');
    expect(detail.recentLessons[0].handover).toBe('単語帳の続きを確認する');
    // handover が空白のみ(trim後空文字)なら null 扱い
    expect(detail.recentLessons[1].handover).toBeNull();
    expect(detail.nextUnitTitles).toEqual(['第3章', '第4章']);
    expect(detail.homeworkNotDoneCount).toBe(1);
    expect(detail.tardyCount).toBe(0);
  });

  it('引継ぎ・宿題未実施・遅刻が無ければ0件を返す（呼び出し側で0を表示しない判断の元データ）', () => {
    const rows = [
      { title: '第1章', sort_order: 1, progress: null },
    ] as unknown as CurriculumItemWithProgress[];
    const detail = summarizeTextbookDetail(textbook, rows);
    expect(detail.homeworkNotDoneCount).toBe(0);
    expect(detail.tardyCount).toBe(0);
    expect(detail.recentLessons).toEqual([]);
  });
});

describe('computeDisciplineMonthly', () => {
  // 2026年7月30日を「今日」として固定する
  const today = new Date(2026, 6, 30);

  it('同一日に複数教材のセッション行があっても日単位で1件として数える（二重計上しない）', () => {
    const sessions = [
      { session_date: '2026-07-10', homework_not_done: true, tardy: false },
      // 同じ日の別教材ぶんの行。宿題忘れは無いが、既に1件立っているので日単位では変わらない
      { session_date: '2026-07-10', homework_not_done: false, tardy: false },
    ];
    const months = computeDisciplineMonthly(sessions, 6, today);
    const july = months.find((m) => m.month === '2026-07')!;
    expect(july.lessonDays).toBe(1);
    expect(july.homeworkMissedDays).toBe(1);
    expect(july.tardyDays).toBe(0);
  });

  it('6ヶ月分を新しい月が先頭になる順で返し、記録の無い月も lessonDays 0 で埋める', () => {
    const sessions = [{ session_date: '2026-07-10', homework_not_done: false, tardy: false }];
    const months = computeDisciplineMonthly(sessions, 6, today);
    expect(months.map((m) => m.month)).toEqual([
      '2026-07',
      '2026-06',
      '2026-05',
      '2026-04',
      '2026-03',
      '2026-02',
    ]);
    // 記録がある7月以外は lessonDays 0 で埋まる
    expect(months.filter((m) => m.month !== '2026-07').every((m) => m.lessonDays === 0)).toBe(true);
  });

  it('集計対象範囲外（7ヶ月前）のセッションは無視される', () => {
    const sessions = [
      // 2026-01 は monthsBack=6 の範囲（2026-02〜2026-07）に入らないため無視される
      { session_date: '2026-01-15', homework_not_done: true, tardy: true },
    ];
    const months = computeDisciplineMonthly(sessions, 6, today);
    expect(months.every((m) => m.lessonDays === 0)).toBe(true);
  });

  it('宿題忘れと遅刻は独立に数えられる', () => {
    const sessions = [
      { session_date: '2026-07-05', homework_not_done: true, tardy: false },
      { session_date: '2026-07-12', homework_not_done: false, tardy: true },
      { session_date: '2026-07-20', homework_not_done: true, tardy: true },
    ];
    const months = computeDisciplineMonthly(sessions, 6, today);
    const july = months.find((m) => m.month === '2026-07')!;
    expect(july.lessonDays).toBe(3);
    expect(july.homeworkMissedDays).toBe(2);
    expect(july.tardyDays).toBe(2);
  });
});

describe('computeDisciplineMonthlyByStudent', () => {
  // 2026年7月30日を「今日」として固定する（computeDisciplineMonthly のテストと同じ基準日）
  const today = new Date(2026, 6, 30);

  it('2生徒の行が正しく生徒ごとに分かれて集計される', () => {
    const rows = [
      {
        student_id: 'student-a',
        session_date: '2026-07-10',
        homework_not_done: true,
        tardy: false,
      },
      {
        student_id: 'student-b',
        session_date: '2026-07-12',
        homework_not_done: false,
        tardy: true,
      },
      {
        student_id: 'student-a',
        session_date: '2026-07-15',
        homework_not_done: false,
        tardy: false,
      },
    ];
    const byStudent = computeDisciplineMonthlyByStudent(rows, 6, today);

    expect(byStudent.size).toBe(2);

    const aJuly = byStudent.get('student-a')!.find((m) => m.month === '2026-07')!;
    expect(aJuly.lessonDays).toBe(2);
    expect(aJuly.homeworkMissedDays).toBe(1);
    expect(aJuly.tardyDays).toBe(0);

    const bJuly = byStudent.get('student-b')!.find((m) => m.month === '2026-07')!;
    expect(bJuly.lessonDays).toBe(1);
    expect(bJuly.homeworkMissedDays).toBe(0);
    expect(bJuly.tardyDays).toBe(1);
  });

  it('rows に登場しない生徒は Map に含まれない', () => {
    const rows = [
      {
        student_id: 'student-a',
        session_date: '2026-07-10',
        homework_not_done: false,
        tardy: false,
      },
    ];
    const byStudent = computeDisciplineMonthlyByStudent(rows, 6, today);
    expect(byStudent.has('student-a')).toBe(true);
    expect(byStudent.has('student-nonexistent')).toBe(false);
    expect(Array.from(byStudent.keys())).toEqual(['student-a']);
  });

  it('既存 computeDisciplineMonthly と同じ結果になる（1生徒ぶんを両方で計算して一致）', () => {
    const studentId = 'student-a';
    const rawSessions = [
      { session_date: '2026-07-05', homework_not_done: true, tardy: false },
      { session_date: '2026-06-20', homework_not_done: false, tardy: true },
    ];
    const rows = rawSessions.map((s) => ({ student_id: studentId, ...s }));

    const direct = computeDisciplineMonthly(rawSessions, 6, today);
    const grouped = computeDisciplineMonthlyByStudent(rows, 6, today).get(studentId);

    expect(grouped).toEqual(direct);
  });
});
