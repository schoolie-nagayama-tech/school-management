import { describe, it, expect } from 'vitest';
import {
  buildHandoverText,
  buildKoushuCurrentLines,
  buildKoushuHistoryLines,
  dedupeConsecutiveHandovers,
  koushuFiscalYear,
  mergeKoushuSeasons,
  summarizeCurrentKoushu,
  buildPreviousCommitmentLines,
  previousFollowUpAskLine,
  previousFollowUpReportLine,
  buildProgressFactLines,
  buildTellSections,
  extractHandover,
  formatKoushuEnrollments,
  formatRegularPatternsSchedule,
  computeScoreSummary,
  summarizeTextbookDetail,
  computeDisciplineMonthly,
  computeDisciplineMonthlyByStudent,
  computeDisciplineMonthlyTotals,
  computeDisciplineOverallTotal,
  formatNaishin,
  buildGoalAchievementLines,
  buildMissingRecordAskLines,
  buildTargetSchoolGapLines,
  buildTargetSchoolTalkLines,
  latestOwnKanagawaNaishin,
  latestOwnNaishin,
  isTargetSchoolFactLine,
  stripTargetSchoolFactLines,
  TARGET_SCHOOL_FACT_PREFIX,
  GOAL_SUBJECT_TO_ASSESSMENT_SUBJECT,
  GOAL_EXAM_NAME_TO_ASSESSMENT_NAME_CODE,
  type ExamGoalForAchievement,
} from '@/app/interview/interview.shared';
import type {
  AssessmentWithScores,
  CurriculumItemWithProgress,
  StudentInterview,
  StudentTextbookWithDetails,
} from '@/types/database';
import type { ScheduleRegularPattern } from '@/types/schedule';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';
import type { SeasonalProposalSeasonSummary } from '@/lib/api/seasonalProposalSummary';
import type { TargetSchoolRow, TargetSchoolMaster } from '@/lib/api/targetSchools';

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

describe('computeDisciplineMonthlyTotals', () => {
  // 2026年7月30日を「今日」として固定する（他の describe と同じ基準日）
  const today = new Date(2026, 6, 30);

  it('2生徒ぶんの月次配列を渡すと月ごとに正しく合算される', () => {
    const studentA = computeDisciplineMonthly(
      [
        { session_date: '2026-07-05', homework_not_done: true, tardy: false },
        { session_date: '2026-07-12', homework_not_done: false, tardy: true },
      ],
      6,
      today
    );
    const studentB = computeDisciplineMonthly(
      [{ session_date: '2026-07-20', homework_not_done: true, tardy: true }],
      6,
      today
    );

    const totals = computeDisciplineMonthlyTotals([studentA, studentB], 6, today);
    const july = totals.find((m) => m.month === '2026-07')!;
    // 生徒A: 授業2日・宿題1・遅刻1 / 生徒B: 授業1日・宿題1・遅刻1 の合算
    expect(july.lessonDays).toBe(3);
    expect(july.homeworkMissedDays).toBe(2);
    expect(july.tardyDays).toBe(2);
  });

  it('studentCount はその月に lessonDays>0 だった生徒数になる（片方だけ記録がある月）', () => {
    const studentA = computeDisciplineMonthly(
      [{ session_date: '2026-07-05', homework_not_done: false, tardy: false }],
      6,
      today
    );
    // 生徒Bは6月のみ記録がある（7月は lessonDays 0）
    const studentB = computeDisciplineMonthly(
      [{ session_date: '2026-06-10', homework_not_done: false, tardy: false }],
      6,
      today
    );

    const totals = computeDisciplineMonthlyTotals([studentA, studentB], 6, today);
    const july = totals.find((m) => m.month === '2026-07')!;
    const june = totals.find((m) => m.month === '2026-06')!;
    expect(july.studentCount).toBe(1); // 7月に授業記録があるのは生徒Aのみ
    expect(june.studentCount).toBe(1); // 6月に授業記録があるのは生徒Bのみ
  });

  it('homeworkStudentCount/tardyStudentCount はその月に該当した生徒数になる（片方だけ宿題忘れがある月）', () => {
    // 生徒Aは7月に宿題忘れのみ、生徒Bは7月に遅刻のみ。両方とも lessonDays>0 だが
    // 宿題忘れ・遅刻それぞれの該当生徒数は1名ずつになるべき（studentCount=2とは別物）。
    const studentA = computeDisciplineMonthly(
      [{ session_date: '2026-07-05', homework_not_done: true, tardy: false }],
      6,
      today
    );
    const studentB = computeDisciplineMonthly(
      [{ session_date: '2026-07-10', homework_not_done: false, tardy: true }],
      6,
      today
    );

    const totals = computeDisciplineMonthlyTotals([studentA, studentB], 6, today);
    const july = totals.find((m) => m.month === '2026-07')!;
    expect(july.studentCount).toBe(2); // 授業記録があるのは2名
    expect(july.homeworkStudentCount).toBe(1); // 宿題忘れがあるのは生徒Aのみ
    expect(july.tardyStudentCount).toBe(1); // 遅刻があるのは生徒Bのみ
  });

  it('同じ生徒が同じ月に複数日の宿題忘れをしても人数は1', () => {
    const studentA = computeDisciplineMonthly(
      [
        { session_date: '2026-07-05', homework_not_done: true, tardy: false },
        { session_date: '2026-07-12', homework_not_done: true, tardy: false },
        { session_date: '2026-07-20', homework_not_done: true, tardy: false },
      ],
      6,
      today
    );

    const totals = computeDisciplineMonthlyTotals([studentA], 6, today);
    const july = totals.find((m) => m.month === '2026-07')!;
    expect(july.homeworkMissedDays).toBe(3); // 回数（延べ日数）は3
    expect(july.homeworkStudentCount).toBe(1); // 人数は1名のまま
  });

  it('空配列を渡すと全月 0・studentCount 0 の6行が新しい月先頭で返る', () => {
    const totals = computeDisciplineMonthlyTotals([], 6, today);
    expect(totals.map((m) => m.month)).toEqual([
      '2026-07',
      '2026-06',
      '2026-05',
      '2026-04',
      '2026-03',
      '2026-02',
    ]);
    expect(
      totals.every(
        (m) =>
          m.lessonDays === 0 &&
          m.homeworkMissedDays === 0 &&
          m.tardyDays === 0 &&
          m.studentCount === 0 &&
          m.homeworkStudentCount === 0 &&
          m.tardyStudentCount === 0
      )
    ).toBe(true);
  });

  it('引数を破壊しない', () => {
    const studentA = computeDisciplineMonthly(
      [{ session_date: '2026-07-05', homework_not_done: true, tardy: false }],
      6,
      today
    );
    const snapshot = JSON.parse(JSON.stringify(studentA));
    computeDisciplineMonthlyTotals([studentA], 6, today);
    expect(studentA).toEqual(snapshot);
  });
});

describe('computeDisciplineOverallTotal', () => {
  // 2026年7月30日を「今日」として固定する（他の describe と同じ基準日）
  const today = new Date(2026, 6, 30);

  it('回数は全月・全生徒の総和になる', () => {
    const studentA = computeDisciplineMonthly(
      [
        { session_date: '2026-07-05', homework_not_done: true, tardy: false },
        { session_date: '2026-06-05', homework_not_done: false, tardy: true },
      ],
      6,
      today
    );
    const studentB = computeDisciplineMonthly(
      [{ session_date: '2026-07-20', homework_not_done: true, tardy: true }],
      6,
      today
    );

    const overall = computeDisciplineOverallTotal([studentA, studentB]);
    expect(overall.lessonDays).toBe(3);
    expect(overall.homeworkMissedDays).toBe(2);
    expect(overall.tardyDays).toBe(2);
  });

  it('人数は月をまたいで重複カウントされない（同じ生徒が5月・6月の両方で宿題忘れ→homeworkStudentCountは1）', () => {
    // 生徒Aは5月と6月の両方で宿題忘れがある。月次では2件（延べ）だが、
    // 期間合計の人数としては「該当した生徒」が1名いるだけなので1にならなければならない。
    const studentA = computeDisciplineMonthly(
      [
        { session_date: '2026-05-10', homework_not_done: true, tardy: false },
        { session_date: '2026-06-10', homework_not_done: true, tardy: false },
      ],
      6,
      today
    );

    const overall = computeDisciplineOverallTotal([studentA]);
    expect(overall.homeworkMissedDays).toBe(2); // 回数（延べ日数）は月をまたいでも単純合算で2
    expect(overall.homeworkStudentCount).toBe(1); // 人数は生徒単位で1（重複カウントしない）
  });

  it('記録が無い生徒は studentCount に含まれない', () => {
    const studentA = computeDisciplineMonthly(
      [{ session_date: '2026-07-05', homework_not_done: false, tardy: false }],
      6,
      today
    );
    // 記録が1件も無い生徒（呼び出し側で emptyMonths が渡されるケースに相当）
    const studentB = computeDisciplineMonthly([], 6, today);

    const overall = computeDisciplineOverallTotal([studentA, studentB]);
    expect(overall.studentCount).toBe(1);
    expect(overall.homeworkStudentCount).toBe(0);
    expect(overall.tardyStudentCount).toBe(0);
  });

  it('空配列で全て0', () => {
    const overall = computeDisciplineOverallTotal([]);
    expect(overall).toEqual({
      lessonDays: 0,
      homeworkMissedDays: 0,
      tardyDays: 0,
      studentCount: 0,
      homeworkStudentCount: 0,
      tardyStudentCount: 0,
    });
  });

  it('引数を破壊しない', () => {
    const studentA = computeDisciplineMonthly(
      [{ session_date: '2026-07-05', homework_not_done: true, tardy: true }],
      6,
      today
    );
    const snapshot = JSON.parse(JSON.stringify(studentA));
    computeDisciplineOverallTotal([studentA]);
    expect(studentA).toEqual(snapshot);
  });
});

describe('formatNaishin', () => {
  it('満点65のときは分母を出さない', () => {
    expect(formatNaishin(45, 65)).toBe('必要内申45');
  });

  it('満点が65以外（3教科校=75, 産業技術高専=52）のときは分母を出す', () => {
    expect(formatNaishin(55, 75)).toBe('必要内申55/75');
    expect(formatNaishin(40, 52)).toBe('必要内申40/52');
  });

  it('naishin が無ければ「未設定」を返す', () => {
    expect(formatNaishin(null, 65)).toBe('必要内申は未設定');
  });

  it('label を差し替えられる', () => {
    expect(formatNaishin(45, 65, '内申')).toBe('内申45');
  });
});

describe('buildGoalAchievementLines', () => {
  // 変換表そのものの検証: 目標側(日本語)と成績側(英語キー)の対応が崩れていないか
  it('科目の変換表が5科すべて揃っている', () => {
    expect(GOAL_SUBJECT_TO_ASSESSMENT_SUBJECT).toEqual({
      数学: 'math',
      英語: 'english',
      国語: 'japanese',
      理科: 'science',
      社会: 'social',
    });
  });

  it('試験名の変換表が9種すべて揃っている', () => {
    expect(Object.keys(GOAL_EXAM_NAME_TO_ASSESSMENT_NAME_CODE).sort()).toEqual(
      [
        '1学期中間',
        '1学期期末',
        '2学期中間',
        '2学期期末',
        '学年末',
        '前期中間',
        '前期期末',
        '後期中間',
        '後期期末',
      ].sort()
    );
  });

  it('結果が突き合ったとき、目標→結果（差分）の1行を伝えるに出す', () => {
    const goals: ExamGoalForAchievement[] = [
      {
        subject_key: '英語',
        exam_type_name: '1学期期末',
        custom_exam_name: null,
        exam_date: '2026-07-10',
        target_score: 75,
      },
    ];
    const assessments = [
      {
        category: 'regular_test',
        name_code: 'term1_final',
        scores: [{ subject: 'english', value: 68 }],
      },
    ] as unknown as AssessmentWithScores[];

    const { tell, ask } = buildGoalAchievementLines(goals, assessments);
    expect(ask).toEqual([]);
    expect(tell).toEqual(['英語 1学期期末 目標75 → 68（-7）']);
  });

  it('目標を上回ったときは「達成」を添える', () => {
    const goals: ExamGoalForAchievement[] = [
      {
        subject_key: '数学',
        exam_type_name: '2学期中間',
        custom_exam_name: null,
        exam_date: '2026-11-01',
        target_score: 70,
      },
    ];
    const assessments = [
      {
        category: 'regular_test',
        name_code: 'term2_mid',
        scores: [{ subject: 'math', value: 73 }],
      },
    ] as unknown as AssessmentWithScores[];

    const { tell } = buildGoalAchievementLines(goals, assessments);
    expect(tell).toEqual(['数学 2学期中間 目標70 → 73（+3・達成）']);
  });

  it('結果が成績側に見つからないときは「聞くこと」に回す（数が多いケースの本体）', () => {
    const goals: ExamGoalForAchievement[] = [
      {
        subject_key: '英語',
        exam_type_name: '1学期期末',
        custom_exam_name: null,
        exam_date: '2026-07-10',
        target_score: 75,
      },
    ];
    // 成績側にまだ何も入っていない
    const { tell, ask } = buildGoalAchievementLines(goals, []);
    expect(tell).toEqual([]);
    expect(ask).toEqual(['英語 1学期期末 目標75点。結果を聞いて入れる']);
  });

  it('試験名が変換表に無い（学校独自の試験名など）ときも聞くことに回す', () => {
    const goals: ExamGoalForAchievement[] = [
      {
        subject_key: '英語',
        exam_type_name: null,
        custom_exam_name: '実力テスト',
        exam_date: '2026-07-10',
        target_score: 75,
      },
    ];
    const assessments = [
      {
        category: 'regular_test',
        name_code: 'term1_final',
        scores: [{ subject: 'english', value: 68 }],
      },
    ] as unknown as AssessmentWithScores[];

    const { tell, ask } = buildGoalAchievementLines(goals, assessments);
    expect(tell).toEqual([]);
    expect(ask).toEqual(['英語 実力テスト 目標75点。結果を聞いて入れる']);
  });

  it('直近の試験（最新の exam_date）のぶんだけに絞る', () => {
    const goals: ExamGoalForAchievement[] = [
      {
        subject_key: '英語',
        exam_type_name: '1学期中間',
        custom_exam_name: null,
        exam_date: '2026-06-01',
        target_score: 70,
      },
      {
        subject_key: '数学',
        exam_type_name: '1学期期末',
        custom_exam_name: null,
        exam_date: '2026-07-10',
        target_score: 80,
      },
    ];
    const { tell, ask } = buildGoalAchievementLines(goals, []);
    // 古い方（1学期中間）は落ち、新しい方（1学期期末）だけが残る
    expect(tell.length + ask.length).toBe(1);
    expect(ask[0]).toContain('数学');
  });

  it('目標が1件も無ければ何も出さない', () => {
    expect(buildGoalAchievementLines([], [])).toEqual({ tell: [], ask: [] });
  });

  it('target_score が無い行は対象外', () => {
    const goals: ExamGoalForAchievement[] = [
      {
        subject_key: '英語',
        exam_type_name: '1学期期末',
        custom_exam_name: null,
        exam_date: '2026-07-10',
        target_score: null,
      },
    ];
    expect(buildGoalAchievementLines(goals, [])).toEqual({ tell: [], ask: [] });
  });

  it('★同じ内容の目標が2件あっても1行にまとめる（聞くこと）', () => {
    // 目標は「生徒×科目」に移したが student_textbook_exams の行はテキストごとに残っており、
    // 同じ科目のテキストを2冊持つ生徒には中身がまったく同じ行が2件できる。
    // 実機（緑園都市校の中3）で②に同じ「聞く」が2行並んだ。
    const same: ExamGoalForAchievement = {
      subject_key: '英語',
      exam_type_name: null,
      custom_exam_name: '学校の成績で「5」をとる',
      exam_date: '2026-10-08',
      target_score: 80,
    };
    const { tell, ask } = buildGoalAchievementLines([same, { ...same }], []);
    expect(tell).toEqual([]);
    expect(ask).toEqual(['英語 学校の成績で「5」をとる 目標80点。結果を聞いて入れる']);
  });

  it('★同じ内容の目標が2件あっても1行にまとめる（伝える）', () => {
    const same: ExamGoalForAchievement = {
      subject_key: '数学',
      exam_type_name: '2学期中間',
      custom_exam_name: null,
      exam_date: '2026-11-01',
      target_score: 70,
    };
    const assessments = [
      {
        category: 'regular_test',
        name_code: 'term2_mid',
        scores: [{ subject: 'math', value: 73 }],
      },
    ] as unknown as AssessmentWithScores[];

    const { tell } = buildGoalAchievementLines([same, { ...same }], assessments);
    expect(tell).toEqual(['数学 2学期中間 目標70 → 73（+3・達成）']);
  });

  it('★科目と試験が同じでも目標点が違えば両方出す（食い違いを隠さない）', () => {
    const base: ExamGoalForAchievement = {
      subject_key: '英語',
      exam_type_name: null,
      custom_exam_name: '学校の成績で「5」をとる',
      exam_date: '2026-10-08',
      target_score: 80,
    };
    const { ask } = buildGoalAchievementLines([base, { ...base, target_score: 90 }], []);
    expect(ask).toHaveLength(2);
  });
});

describe('buildMissingRecordAskLines', () => {
  it('定期テスト・模試どちらも無ければ両方を聞くことに出す', () => {
    expect(buildMissingRecordAskLines([], 9)).toEqual([
      '定期テストの結果を聞いて入れる',
      '模試を受けているか聞く',
    ]);
  });

  it('定期テストだけあれば模試の分だけ出す', () => {
    const assessments = [
      { category: 'regular_test', name_code: 'term1_final', scores: [] },
    ] as unknown as AssessmentWithScores[];
    expect(buildMissingRecordAskLines(assessments, 9)).toEqual(['模試を受けているか聞く']);
  });

  it('両方あれば何も出さない', () => {
    const assessments = [
      { category: 'regular_test', name_code: 'term1_final', scores: [] },
      { category: 'mock', name_code: 'venue', scores: [] },
    ] as unknown as AssessmentWithScores[];
    expect(buildMissingRecordAskLines(assessments, 9)).toEqual([]);
  });

  it('小学生（学年6以下）には出さない', () => {
    expect(buildMissingRecordAskLines([], 6)).toEqual([]);
  });

  it('学年が不明（null）なら出さない', () => {
    expect(buildMissingRecordAskLines([], null)).toEqual([]);
  });

  it('中1（学年7）は中学生扱いで出す', () => {
    expect(buildMissingRecordAskLines([], 7)).toEqual([
      '定期テストの結果を聞いて入れる',
      '模試を受けているか聞く',
    ]);
  });
});

describe('buildTargetSchoolGapLines', () => {
  function targetSchool(
    overrides: Partial<TargetSchoolMaster> & { rank?: number }
  ): TargetSchoolRow {
    const { rank = 1, ...master } = overrides;
    return {
      id: 'ts-1',
      rank,
      schoolName: '清瀬',
      highSchoolId: 'hs-1',
      reason: null,
      updatedAt: '2026-09-01T00:00:00Z',
      master: {
        prefecture: '東京都',
        schoolName: '清瀬',
        course: '',
        category: '普通科',
        naishin: 45,
        naishinMax: 65,
        hensachi: 51,
        sourceLabel: 'Vもぎ 2025年9月版',
        verifiedAt: null,
        accessLines: [],
        ...master,
      },
    };
  }

  const reportCardAssessment = {
    category: 'report_card',
    name_code: 'term2',
    scores: [
      { subject: 'english', value: 4 },
      { subject: 'math', value: 4 },
      { subject: 'japanese', value: 4 },
      { subject: 'science', value: 3 },
      { subject: 'social', value: 4 },
      { subject: 'music', value: 3 },
      { subject: 'art', value: 3 },
      { subject: 'tech_home', value: 3 },
      { subject: 'pe', value: 4 },
    ],
  } as unknown as AssessmentWithScores;
  // 5科(4+4+4+3+4=19) + 実技4科(3+3+3+4=13)*2=26 → 換算内申45（65点満点）
  const mockAssessment = {
    category: 'mock',
    name_code: 'classroom',
    scores: [{ subject: 'hensa_5', value: 48 }],
  } as unknown as AssessmentWithScores;

  it('志望校が未登録なら聞くことに「志望校を聞いて入れる」だけを出す', () => {
    const result = buildTargetSchoolGapLines([], [reportCardAssessment, mockAssessment]);
    expect(result).toEqual({ tell: [], ask: ['志望校を聞いて入れる'] });
  });

  it('マスタに当たり本人の内申・偏差値も取れるときだけ、必要内申・必要偏差値と差を出す', () => {
    const schools = [targetSchool({ naishin: 45, naishinMax: 65, hensachi: 51 })];
    const { tell, ask } = buildTargetSchoolGapLines(schools, [
      reportCardAssessment,
      mockAssessment,
    ]);
    expect(ask).toEqual([]);
    expect(tell).toHaveLength(1);
    // 本人内申45・偏差値48 に対し、必要内申45(diff 0)・必要偏差値51(diff -3)
    expect(tell[0]).toContain('第1 清瀬');
    expect(tell[0]).toContain('必要内申45（+0）');
    expect(tell[0]).toContain('必要偏差値51（-3）');
  });

  it('満点が65以外（3教科校=75）のときは必要内申に分母を添える', () => {
    const schools = [targetSchool({ naishin: 55, naishinMax: 75, hensachi: null })];
    const { tell } = buildTargetSchoolGapLines(schools, [reportCardAssessment]);
    expect(tell[0]).toContain('必要内申55/75');
  });

  it('出典（Vもぎ・版）と、verified_at が null なら「原本との突き合わせは未了」を添える', () => {
    const schools = [
      targetSchool({ naishin: 45, naishinMax: 65, hensachi: null, verifiedAt: null }),
    ];
    const { tell } = buildTargetSchoolGapLines(schools, [reportCardAssessment]);
    expect(tell[0]).toContain('Vもぎ 2025年9月版・合格可能性60%の位置');
    expect(tell[0]).toContain('原本との突き合わせは未了');
  });

  it('verified_at が入っていれば「突き合わせ未了」を出さない', () => {
    const schools = [
      targetSchool({
        naishin: 45,
        naishinMax: 65,
        hensachi: null,
        verifiedAt: '2026-09-01T00:00:00Z',
      }),
    ];
    const { tell } = buildTargetSchoolGapLines(schools, [reportCardAssessment]);
    expect(tell[0]).not.toContain('突き合わせ');
  });

  it('★マスタに当たっていない（私立など）志望校も、学校名だけの行を出す（第2段）', () => {
    const schools: TargetSchoolRow[] = [
      {
        id: 'ts-2',
        rank: 1,
        schoolName: '私立A高校',
        highSchoolId: null,
        reason: null,
        updatedAt: '2026-09-01T00:00:00Z',
        master: null,
      },
    ];
    const { tell, ask } = buildTargetSchoolGapLines(schools, [
      reportCardAssessment,
      mockAssessment,
    ]);
    // 登録されている志望校は必ず1行出す。めやすはマスタに当たったときだけ添える
    expect(tell).toEqual(['第1 私立A高校']);
    expect(ask).toEqual([]);
  });

  it('★本人の内申・偏差値が取れないときは、めやすだけを出して差は出さない', () => {
    const schools = [targetSchool({ naishin: 45, naishinMax: 65, hensachi: 51 })];
    const { tell } = buildTargetSchoolGapLines(schools, []);
    expect(tell[0]).toContain('めやす 必要内申45・必要偏差値51');
    expect(tell[0]).not.toMatch(/（[+-]\d+）/);
  });

  it('★沿線は出す。最寄駅は出さない（直線距離で使えない）', () => {
    const schools = [targetSchool({ accessLines: ['西武池袋線', 'JR武蔵野線'] })];
    const { tell } = buildTargetSchoolGapLines(schools, [reportCardAssessment]);
    expect(tell[0]).toContain('沿線: 西武池袋線・JR武蔵野線');
  });

  it('学科（course）が空文字＝普通科の本体なので括弧ごと出さない', () => {
    expect(buildTargetSchoolGapLines([targetSchool({ course: '' })], []).tell[0]).toContain(
      '第1 清瀬 ／'
    );
    expect(buildTargetSchoolGapLines([targetSchool({ course: '外国語' })], []).tell[0]).toContain(
      '第1 清瀬（外国語）'
    );
  });
});

describe('★満点が違う学校と差を取らない', () => {
  const mock = (naishin: number, naishinMax: number | null) => [
    {
      id: 'x',
      rank: 1,
      schoolName: '駒場',
      highSchoolId: 'h1',
      reason: null,
      updatedAt: '2026-09-01',
      master: {
        prefecture: '東京都',
        schoolName: '駒場',
        course: '保健体育',
        category: '国際・科学技術・産業・芸術・体育科',
        naishin,
        naishinMax,
        hensachi: null,
        sourceLabel: 'Vもぎ 2025年9月版',
        verifiedAt: null,
      },
    },
  ];
  // 本人の換算内申41（65点満点）が取れる通知表
  const reportCard = [
    {
      id: 'a1',
      category: 'report_card' as const,
      name_code: 'term1',
      exam_date: '2026-07-01',
      scores: [
        { subject: 'japanese', value: 4 },
        { subject: 'math', value: 5 },
        { subject: 'english', value: 4 },
        { subject: 'science', value: 4 },
        { subject: 'social', value: 4 },
        { subject: 'music', value: 3 },
        { subject: 'art', value: 3 },
        { subject: 'pe', value: 4 },
        { subject: 'tech_home', value: 3 },
      ],
    },
  ];

  it('65点満点どうしなら差を出す', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = buildTargetSchoolGapLines(mock(45, 65) as any, reportCard as any);
    expect(out.tell[0]).toMatch(/必要内申45（[+-]\d+）/);
  });

  it('★75点満点（3教科校）とは差を出さない。引くと嘘の数字になる', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = buildTargetSchoolGapLines(mock(55, 75) as any, reportCard as any);
    expect(out.tell[0]).toContain('必要内申55/75');
    expect(out.tell[0]).not.toMatch(/必要内申55\/75（[+-]/);
  });

  it('★52点満点（産業技術高専）とも差を出さない', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = buildTargetSchoolGapLines(mock(33, 52) as any, reportCard as any);
    expect(out.tell[0]).toContain('必要内申33/52');
    expect(out.tell[0]).not.toMatch(/33\/52（[+-]/);
  });
});

/* ============================================================
 * 第2段（②④⑤の中身）
 * 正典: docs/interview-workspace-layout-2026-09.md §「中身の追加（第2段）」
 * ========================================================== */

/** 面談記録・タスクの最小行（型の穴埋めはテストに要らない項目だけ） */
function interviewRow(over: Partial<StudentInterview>): StudentInterview {
  return {
    id: 'i1',
    school_id: 's1',
    student_id: 'st1',
    interview_date: '2026-09-01',
    interview_type: 'parent_interview',
    title: null,
    content: '',
    is_completed: false,
    completed_at: null,
    created_by: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

const NOTTA_RECORD = [
  '【タイトル】面談',
  '【録音日時】2026/09/01 17:00',
  '【音声URL】https://example.com/a.mp3',
  '--- Notta 要約 ---',
  '■ 保護者からの要望',
  '・英語の宿題を減らしてほしい',
  '・土曜の振替を増やしたい',
  '■ 塾からの報告',
  '・数学は順調',
  '■ 前回の確認',
  '・会話の中で確認できませんでした',
].join('\n');

describe('buildPreviousCommitmentLines（②ヒアリング）', () => {
  it('未完了のタスクを「前回の約束」として1件1行にし、記録日を M/D で添える', () => {
    const rows = [
      interviewRow({
        id: 't1',
        interview_type: 'task',
        content: '英語ワークP10まで',
        interview_date: '2026-08-05',
      }),
      interviewRow({
        id: 't2',
        interview_type: 'task',
        content: '模試の申込',
        is_completed: true,
      }),
    ];
    const { promises } = buildPreviousCommitmentLines(rows);
    expect(promises).toEqual(['英語ワークP10まで（8/5・未完了）']);
  });

  it('直近の面談記録の「要望」「申し送り」「今後の方針」の箇条書きを前回の要望に出す', () => {
    const { requests } = buildPreviousCommitmentLines([interviewRow({ content: NOTTA_RECORD })]);
    expect(requests).toEqual(['英語の宿題を減らしてほしい', '土曜の振替を増やしたい']);
  });

  it('★中身が無い見出し（確認できませんでした）は拾わない', () => {
    const { requests } = buildPreviousCommitmentLines([
      interviewRow({
        content: ['■ 保護者からの要望', '・会話の中で確認できませんでした'].join('\n'),
      }),
    ]);
    expect(requests).toEqual([]);
  });

  it('約束・要望の1件ごとに「その後どうですか」を組む（同じ文面は1つにまとめる）', () => {
    const rows = [
      interviewRow({ content: NOTTA_RECORD }),
      interviewRow({ id: 't1', interview_type: 'task', content: '英語の宿題を減らしてほしい' }),
    ];
    const { asks } = buildPreviousCommitmentLines(rows);
    expect(asks).toEqual([
      '前回の「英語の宿題を減らしてほしい」はその後どうですか',
      '前回の「土曜の振替を増やしたい」はその後どうですか',
    ]);
  });

  it('長い文面は40字で切って…を付ける（面談で読み上げられる長さにする）', () => {
    const long = 'あ'.repeat(60);
    const { asks } = buildPreviousCommitmentLines([
      interviewRow({ id: 't1', interview_type: 'task', content: long }),
    ]);
    expect(asks[0]).toBe(`前回の「${'あ'.repeat(40)}…」はその後どうですか`);
  });

  it('タスクも記録も無ければ何も出ない', () => {
    expect(buildPreviousCommitmentLines([])).toEqual({
      promises: [],
      requests: [],
      asks: [],
      items: [],
    });
  });

  /**
   * ★「聞く」か「報告する」かは中身で決まる（2026-09-23・教室長の指摘）。
   *   判定は原則AI（followUps）だが、AIが使えない日に振る受け皿がここ。
   */
  it('★items は出どころ付き。保護者からの要望は「報告」、約束は「聞く」に振る', () => {
    const rows = [
      interviewRow({ content: NOTTA_RECORD }),
      interviewRow({ id: 't1', interview_type: 'task', content: '英語ワークP10まで' }),
    ];
    const { items } = buildPreviousCommitmentLines(rows);
    // 並びは約束が先（面談で話す順）
    expect(items[0]).toEqual({ text: '英語ワークP10まで', source: 'task', fallback: 'ask' });
    expect(items[1]).toEqual({
      text: '英語の宿題を減らしてほしい',
      source: '保護者からの要望',
      fallback: 'report',
    });
    expect(items[2].fallback).toBe('report');
  });

  it('★「今後の方針」「次回への申し送り」は聞くほう（家庭が動いた結果を聞く）', () => {
    const { items } = buildPreviousCommitmentLines([
      interviewRow({
        content: [
          '--- Notta 要約 ---',
          '■ 今後の方針',
          '・慶應を含めて最後まで検討する',
          '■ 次回への申し送り',
          '・冬期の受講科目を決める',
        ].join('\n'),
      }),
    ]);
    expect(items.map((i) => [i.source, i.fallback])).toEqual([
      ['今後の方針', 'ask'],
      ['次回への申し送り', 'ask'],
    ]);
  });

  it('同じ文面が約束と要望の両方にあるときは1件だけ（約束のほうを残す）', () => {
    const rows = [
      interviewRow({ content: NOTTA_RECORD }),
      interviewRow({ id: 't1', interview_type: 'task', content: '英語の宿題を減らしてほしい' }),
    ];
    const { items } = buildPreviousCommitmentLines(rows);
    expect(items.filter((i) => i.text === '英語の宿題を減らしてほしい')).toEqual([
      { text: '英語の宿題を減らしてほしい', source: 'task', fallback: 'ask' },
    ]);
  });
});

describe('previousFollowUpAskLine / previousFollowUpReportLine', () => {
  it('聞く行と報告行の文言（画面と印刷シートで同じ関数を使う）', () => {
    expect(previousFollowUpAskLine('英語ワークP10まで')).toBe(
      '前回の「英語ワークP10まで」はその後どうですか'
    );
    expect(previousFollowUpReportLine('英語の長文を増やしてほしい')).toBe(
      '報告 ―― 前回の要望「英語の長文を増やしてほしい」への対応を伝える'
    );
  });
});

describe('buildHandoverText（②ヒアリング・AIにも渡る文面）', () => {
  it('「## 次回への申し送り」があればそれを使う', () => {
    const text = buildHandoverText(
      '前置き\n## 次回への申し送り\n英語の単語を続ける\n## 別の見出し'
    );
    expect(text).toBe('英語の単語を続ける');
  });

  it('★Nottaの本文はメタ行と空の見出しを落として「見出し: 箇条書き」に畳む', () => {
    const text = buildHandoverText(NOTTA_RECORD);
    expect(text).not.toContain('録音日時');
    expect(text).not.toContain('確認できませんでした');
    expect(text).toContain('保護者からの要望: 英語の宿題を減らしてほしい／土曜の振替を増やしたい');
    expect(text).toContain('｜塾からの報告: 数学は順調');
  });

  it('Nottaに「次回への申し送り」の節があればそこだけを使う', () => {
    const text = buildHandoverText(
      ['■ 塾からの報告', '・数学は順調', '■ 次回への申し送り', '・英語の語彙を続ける'].join('\n')
    );
    expect(text).toBe('英語の語彙を続ける');
  });

  it('構造化できない手入力の記録はそのまま（メタ行だけ落とす）', () => {
    expect(buildHandoverText('数学の復習を家でも続けることになった')).toBe(
      '数学の復習を家でも続けることになった'
    );
  });
});

describe('buildProgressFactLines（④現状の確認）', () => {
  const textbook = (
    id: string,
    name: string,
    subject: string,
    sortOrder: number
  ): StudentTextbookWithDetails =>
    ({
      id,
      sort_order: sortOrder,
      textbook: { id: 1, name, subject },
    }) as unknown as StudentTextbookWithDetails;

  const item = (
    title: string,
    sortOrder: number,
    lessons: { lesson_date: string; teacher_name?: string | null }[],
    handover?: string
  ): CurriculumItemWithProgress =>
    ({
      id: `c-${title}`,
      title,
      sort_order: sortOrder,
      progress: lessons.length > 0 || handover ? { lessons, handover: handover ?? null } : null,
    }) as unknown as CurriculumItemWithProgress;

  it('★科目ごとに最終利用日が最新の1冊（LIVE）だけを出す。進捗%は出さない', () => {
    const data = [
      {
        textbook: textbook('tb-old', '旧テキスト', 'math', 1),
        rows: [item('式の計算', 1, [{ lesson_date: '2026-06-01' }])],
      },
      {
        textbook: textbook('tb-new', '新テキスト', 'math', 2),
        rows: [
          item(
            '二次関数',
            1,
            [{ lesson_date: '2026-09-01', teacher_name: '山田' }],
            '符号ミスが多い'
          ),
        ],
      },
    ];
    const lines = buildProgressFactLines(data);
    expect(lines.some((l) => l.includes('旧テキスト'))).toBe(false);
    expect(lines[0]).toBe('新テキスト（数学） 最終記入 9/1');
    expect(lines[1]).toBe('9/1 二次関数（山田）：符号ミスが多い');
    expect(lines.join('')).not.toContain('%');
  });

  it('直近3回まで・新しい順に出し、次にやる単元を添える', () => {
    const data = [
      {
        textbook: textbook('tb', 'テキスト', 'english', 1),
        rows: [
          item('Unit1', 1, [{ lesson_date: '2026-09-01' }]),
          item('Unit2', 2, [{ lesson_date: '2026-09-08' }]),
          item('Unit3', 3, [{ lesson_date: '2026-09-15' }]),
          item('Unit4', 4, [{ lesson_date: '2026-09-22' }]),
          item('Unit5', 5, []),
          item('Unit6', 6, []),
        ],
      },
    ];
    const lines = buildProgressFactLines(data);
    expect(lines).toEqual([
      'テキスト（英語） 最終記入 9/22',
      '9/22 Unit4',
      '9/15 Unit3',
      '9/8 Unit2',
      '次 ―― Unit5、Unit6',
    ]);
  });

  it('授業記録が1件も無い教材は出さない（LIVEの候補にしない）', () => {
    const data = [
      { textbook: textbook('tb', '未使用', 'math', 1), rows: [item('式の計算', 1, [])] },
    ];
    expect(buildProgressFactLines(data)).toEqual([]);
  });

  it('同じ最終利用日なら手動の並び順（sort_order）が上の教材を採る', () => {
    const data = [
      {
        textbook: textbook('tb-b', 'B', 'math', 2),
        rows: [item('B1', 1, [{ lesson_date: '2026-09-01' }])],
      },
      {
        textbook: textbook('tb-a', 'A', 'math', 1),
        rows: [item('A1', 1, [{ lesson_date: '2026-09-01' }])],
      },
    ];
    expect(buildProgressFactLines(data)[0]).toContain('A（数学）');
  });
});

describe('講習（⑤プラン提示）', () => {
  const subjectNames = { 'sub-math': '数学', 'sub-eng': '英語' };

  // 提案書（seasonal_proposals）の期ごとのまとめ。★これが本番の主材料
  const summary = (
    over: Partial<SeasonalProposalSeasonSummary>
  ): SeasonalProposalSeasonSummary => ({
    year: 2026,
    season: 'summer',
    status: 'approved',
    komaBySubject: {},
    totalKoma: 0,
    ...over,
  });

  // koushu_enrollments（2027-02公開のWeb申込の入力源。本番はいま0行）
  const enrollment = (over: Partial<KoushuEnrollment>): KoushuEnrollment =>
    ({
      id: 'e1',
      course_id: null,
      student_id: 'st1',
      formation: 'kobetsu',
      koma_count: 0,
      subject_ids: [],
      created_at: '2026-07-01T00:00:00Z',
      updated_at: null,
      ...over,
    }) as unknown as KoushuEnrollment;

  const buckets = (
    summaries: SeasonalProposalSeasonSummary[],
    enrollments: KoushuEnrollment[] = []
  ) => mergeKoushuSeasons(summaries, enrollments, subjectNames);

  describe('koushuFiscalYear', () => {
    it('★1〜3月は前年度に属する（年度は4月始まり）', () => {
      expect(koushuFiscalYear(new Date(2027, 0, 15))).toBe(2026);
      expect(koushuFiscalYear(new Date(2027, 2, 20))).toBe(2026);
      expect(koushuFiscalYear(new Date(2026, 3, 1))).toBe(2026);
      expect(koushuFiscalYear(new Date(2026, 8, 23))).toBe(2026);
    });
  });

  describe('buildKoushuHistoryLines', () => {
    it('今期を除いた期を新しい順に「期ラベル 年：科目 nコマ（申込）」で出す', () => {
      const rows = buckets([
        summary({ season: 'summer', komaBySubject: { 数学: 8, 英語: 6 }, totalKoma: 14 }),
        summary({ season: 'spring', komaBySubject: { 英語: 4 }, totalKoma: 4 }),
        // 今期（冬期 2026）は今期の行が出すので履歴には出さない
        summary({ season: 'winter', komaBySubject: { 数学: 8 }, totalKoma: 8 }),
      ]);
      expect(buildKoushuHistoryLines(rows, 2026, 'winter')).toEqual([
        '夏期 2026：数学 8コマ・英語 6コマ（申込）',
        '春期 2026：英語 4コマ（申込）',
      ]);
    });

    it('★下書き・提案中の過去の期は出さない（出したが取らなかった行はノイズ）', () => {
      const rows = buckets([
        summary({ season: 'summer', status: 'sent', komaBySubject: { 数学: 8 }, totalKoma: 8 }),
        summary({ season: 'spring', status: 'draft', komaBySubject: { 英語: 4 }, totalKoma: 4 }),
      ]);
      expect(buildKoushuHistoryLines(rows, 2026, 'winter')).toEqual([]);
    });

    it('同じ期の提案書は科目ごとに足し合わせる', () => {
      const rows = buckets([
        summary({ season: 'summer', komaBySubject: { 数学: 8 }, totalKoma: 8 }),
        summary({ season: 'summer', komaBySubject: { 数学: 4 }, totalKoma: 4 }),
      ]);
      expect(buildKoushuHistoryLines(rows, 2026, 'winter')).toEqual([
        '夏期 2026：数学 12コマ（申込）',
      ]);
    });

    it('★koushu_enrollments の行は同じ期の提案書に足し込む（消さずに合流させる）', () => {
      const rows = buckets(
        [summary({ season: 'summer', komaBySubject: { 数学: 8 }, totalKoma: 8 })],
        [
          enrollment({
            season: 'summer',
            koma_count: 6,
            koma_by_subject: { 'sub-eng': 6 },
            created_at: '2026-07-01T00:00:00Z',
          }),
        ]
      );
      expect(buildKoushuHistoryLines(rows, 2026, 'winter')).toEqual([
        '夏期 2026：数学 8コマ・英語 6コマ（申込）',
      ]);
    });

    it('★科目別の内訳が無い行は総コマ数だけ出す（黙って0コマにしない）', () => {
      const rows = buckets([], [enrollment({ season: 'summer', koma_count: 10 })]);
      expect(buildKoushuHistoryLines(rows, 2026, 'winter')).toEqual(['夏期 2026：10コマ（申込）']);
    });

    it('今期しか無ければ履歴の行を出さない', () => {
      const rows = buckets([summary({ season: 'winter', totalKoma: 8 })]);
      expect(buildKoushuHistoryLines(rows, 2026, 'winter')).toEqual([]);
    });
  });

  describe('buildKoushuCurrentLines', () => {
    it('今期の提案を科目ごとに並べ、状態を添える', () => {
      const rows = buckets([
        summary({ season: 'winter', komaBySubject: { 数学: 8, 英語: 6 }, totalKoma: 14 }),
      ]);
      expect(buildKoushuCurrentLines(rows, 2026, 'winter')).toEqual([
        '提案 数学 8コマ・英語 6コマ（申込済）',
      ]);
    });

    it('sent は（提案中）・draft は（下書き）', () => {
      expect(
        buildKoushuCurrentLines(
          buckets([summary({ season: 'winter', status: 'sent', komaBySubject: { 数学: 8 } })]),
          2026,
          'winter'
        )
      ).toEqual(['提案 数学 8コマ（提案中）']);
      expect(
        buildKoushuCurrentLines(
          buckets([summary({ season: 'winter', status: 'draft', komaBySubject: { 数学: 8 } })]),
          2026,
          'winter'
        )
      ).toEqual(['提案 数学 8コマ（下書き）']);
    });

    it('★コマ数が1つも入っていなければ「提案あり・コマ未確定」（黙らない）', () => {
      const rows = buckets([
        summary({ season: 'winter', status: 'sent', komaBySubject: { 数学: 0 }, totalKoma: 0 }),
      ]);
      expect(buildKoushuCurrentLines(rows, 2026, 'winter')).toEqual([
        '提案あり・コマ未確定（提案中）',
      ]);
    });

    it('今期の提案書が無ければ行を出さない', () => {
      const rows = buckets([summary({ season: 'summer' })]);
      expect(buildKoushuCurrentLines(rows, 2026, 'winter')).toEqual([]);
    });
  });

  describe('summarizeCurrentKoushu', () => {
    it('今期があればその期のコマ数と状態を出す', () => {
      const rows = buckets([summary({ season: 'winter', totalKoma: 14 })]);
      expect(summarizeCurrentKoushu(rows, 2026, 'winter')).toEqual({
        label: '冬期 2026 14コマ（申込済）',
        koma: 14,
        applied: true,
        isCurrentSeason: true,
      });
    });

    it('★今期が空でも「申込なし」で終わらせず、直近の期を添える', () => {
      const rows = buckets([summary({ season: 'summer', totalKoma: 98 })]);
      expect(summarizeCurrentKoushu(rows, 2026, 'winter')).toEqual({
        label: '冬期 2026 は申込なし（直近 夏期 2026 98コマ・申込済）',
        koma: 98,
        applied: false,
        isCurrentSeason: false,
      });
    });

    it('1件も無ければ「申込なし」', () => {
      expect(summarizeCurrentKoushu([], 2026, 'winter')).toEqual({
        label: '申込なし',
        koma: 0,
        applied: false,
        isCurrentSeason: false,
      });
    });
  });
});

describe('dedupeConsecutiveHandovers（④LIVE進行表）', () => {
  const lesson = (
    lessonDate: string,
    unitTitle: string,
    teacherName: string | null,
    handover: string | null
  ) => ({ lessonDate, unitTitle, teacherName, handover });

  it('★同じ講師・同じ引継ぎ文が続いたら、いちばん新しい1件だけ残す', () => {
    const rows = [
      lesson('2026-09-15', '2次方程式', '広田', '計算は安定。文章題は復習が要る'),
      lesson('2026-09-11', '2次方程式', '広田', '計算は安定。文章題は復習が要る'),
      lesson('2026-09-04', '因数分解', '広田', '公式の使い分けを確認'),
    ];
    expect(dedupeConsecutiveHandovers(rows).map((r) => r.lessonDate)).toEqual([
      '2026-09-15',
      '2026-09-04',
    ]);
  });

  it('★引継ぎが空の行は畳まない（別の単元が消えて何をやったか分からなくなる）', () => {
    const rows = [
      lesson('2026-09-15', '2次方程式', '広田', null),
      lesson('2026-09-11', '因数分解', '広田', ''),
    ];
    expect(dedupeConsecutiveHandovers(rows)).toHaveLength(2);
  });

  it('★連続していなければ残す（時系列が飛ぶと読めなくなる）', () => {
    const rows = [
      lesson('2026-09-15', 'A', '広田', '同じ文'),
      lesson('2026-09-11', 'B', '広田', '別の文'),
      lesson('2026-09-04', 'C', '広田', '同じ文'),
    ];
    expect(dedupeConsecutiveHandovers(rows)).toHaveLength(3);
  });

  it('講師が違えば同じ文でも残す', () => {
    const rows = [
      lesson('2026-09-15', 'A', '広田', '同じ文'),
      lesson('2026-09-11', 'A', '田中', '同じ文'),
    ];
    expect(dedupeConsecutiveHandovers(rows)).toHaveLength(2);
  });
});

describe('buildTellSections（AIへ渡す現状の行）', () => {
  const base = {
    assessments: [] as AssessmentWithScores[],
    interviews: [] as StudentInterview[],
    textbookData: [],
    disciplineSessions: [],
    koushuEnrollments: [],
  };

  const school = {
    id: 'ts1',
    rank: 1,
    schoolName: '清瀬',
    highSchoolId: 'hs1',
    reason: null,
    updatedAt: '2026-09-01T00:00:00Z',
    master: {
      prefecture: '東京都',
      schoolName: '清瀬',
      course: '',
      category: '普通科',
      naishin: 45,
      naishinMax: 65,
      hensachi: 51,
      sourceLabel: 'Vもぎ 2025年9月版',
      verifiedAt: null,
      accessLines: ['西武池袋線'],
    },
  };

  it('★志望校の行は score に混ぜて送る（④でAIが志望校に触れられるように）', () => {
    const sections = buildTellSections({ ...base, targetSchools: [school] });
    const score = sections.find((s) => s.key === 'score');
    expect(score).toBeTruthy();
    const targetLines = score!.current.filter(isTargetSchoolFactLine);
    expect(targetLines).toHaveLength(1);
    expect(targetLines[0]).toContain(TARGET_SCHOOL_FACT_PREFIX);
    // ★画面・紙は「志望校」の行を別に出すので、表示側はこの行を外して二重に出さない
    expect(stripTargetSchoolFactLines(score!.current)).toEqual([]);
  });

  it('志望校が無ければ score の行は増えない', () => {
    expect(buildTellSections(base).find((s) => s.key === 'score')).toBeUndefined();
  });

  it('前回の面談からの申し送りは、空の見出しを畳んだ文面で渡す', () => {
    const sections = buildTellSections({
      ...base,
      interviews: [interviewRow({ content: NOTTA_RECORD })],
    });
    const last = sections.find((s) => s.key === 'lastInterview');
    expect(last!.current.join('')).not.toContain('確認できませんでした');
    expect(last!.current.some((l) => l.startsWith('申し送り: '))).toBe(true);
  });
});

describe('前回の要望から「無い」と論評を外す（2026-09-23 教室長レビュー）', () => {
  // 小川 華佳さんの実物の文（Nottaの要約）
  const OGAWA_RECORD = [
    '--- Notta 要約 ---',
    '■ 保護者からの要望',
    '・保護者からの明確な要望として確認できる発言はありません。',
    '・要望の強さは、具体的な依頼というより進路選択に関する相談・不安の表明レベルです。',
    '■ 前回の確認',
    '・前回の面談での約束事項について明確な記録は確認できません',
    '■ 相談事項',
    '・狛江と調布北で迷っている',
  ].join('\n');

  it('★常体の「確認できなかった。」も前回の要望に出さない（松村 知佳さんの実例）', () => {
    const { requests, items } = buildPreviousCommitmentLines([
      interviewRow({
        content: [
          '■ 保護者からの要望',
          '・保護者からの要望は会話内では確認できなかった。',
          '・保護者の感情面についても会話内では確認できなかった。',
          '・宿題をやらなかった日が続いたので声かけしてほしい',
        ].join('\n'),
      }),
    ]);
    // 「なかった」で終わる中身のある要望は残す（単独の「なかった」では消さない）
    expect(requests).toEqual(['宿題をやらなかった日が続いたので声かけしてほしい']);
    expect(items.map((i) => i.text)).toEqual(['宿題をやらなかった日が続いたので声かけしてほしい']);
  });

  it('★「発言はありません」と論評の箇条書きは前回の要望に出さない', () => {
    const { requests, items, asks } = buildPreviousCommitmentLines([
      interviewRow({ content: OGAWA_RECORD }),
    ]);
    expect(requests).toEqual([]);
    expect(items).toEqual([]);
    expect(asks).toEqual([]);
  });

  it('★「報告 ―― …への対応を伝える」の受け皿も立たない（items が空なので）', () => {
    const { items } = buildPreviousCommitmentLines([interviewRow({ content: OGAWA_RECORD })]);
    const reports = items
      .filter((i) => i.fallback === 'report')
      .map((i) => previousFollowUpReportLine(i.text));
    expect(reports).toEqual([]);
  });

  it('要望そのものは残す（論評の判定を広げすぎない）', () => {
    const { requests } = buildPreviousCommitmentLines([
      interviewRow({
        content: [
          '■ 保護者からの要望',
          '・英語の長文を増やしてほしい',
          '・要望の強さは、具体的な依頼というより相談レベルです。',
        ].join('\n'),
      }),
    ]);
    expect(requests).toEqual(['英語の長文を増やしてほしい']);
  });

  it('★Notta が様子から推し量った所見（〜が見られます／〜がうかがえます）も要望に拾わない', () => {
    const { requests, items } = buildPreviousCommitmentLines([
      interviewRow({
        content: [
          '■ 保護者からの要望',
          '・推薦入試の結果や志望校の倍率に対する不安が強く、早く安心したい気持ちが見られます。',
          '・進路面では、推薦入試を活用して早期に進路を決めたいという意向・期待がうかがえます。',
          '・過去問の進め方を教えてほしい',
        ].join('\n'),
      }),
    ]);
    expect(requests).toEqual(['過去問の進め方を教えてほしい']);
    expect(items.map((i) => i.text)).toEqual(['過去問の進め方を教えてほしい']);
  });

  it('★今後の方針でも、塾が引き受けた行動（〜を確認します）は報告に振る', () => {
    const { items } = buildPreviousCommitmentLines([
      interviewRow({
        content: [
          '■ 今後の方針',
          '・次回までに、内申・加点を踏まえた志望校の可能性、推薦入試の条件を確認します。',
          '・面接対策を進め、本番の緊張に対応できるよう準備します。',
          '・私立単願に限定しない進路方針を検討します。',
        ].join('\n'),
      }),
    ]);
    expect(items.map((i) => i.fallback)).toEqual(['report', 'report', 'ask']);
    expect(previousFollowUpReportLine(items[0].text, items[0].source)).toMatch(
      /^報告 ―― 前回決めた「.+」の進み具合を伝える$/
    );
  });

  it('要望から来た報告は「対応を伝える」のまま', () => {
    expect(previousFollowUpReportLine('長文を増やしてほしい', '保護者からの要望')).toBe(
      '報告 ―― 前回の要望「長文を増やしてほしい」への対応を伝える'
    );
  });

  it('申し送りの文面にも「確認できません」の1件が混ざらない', () => {
    const text = buildHandoverText(OGAWA_RECORD);
    expect(text).not.toContain('確認できません');
    expect(text).not.toContain('発言はありません');
    expect(text).toContain('狛江と調布北で迷っている');
  });
});

describe('buildTargetSchoolTalkLines（④の左・志望校について話すこと）', () => {
  function school(
    name: string,
    master: Partial<TargetSchoolMaster> | null,
    rank = 1
  ): TargetSchoolRow {
    return {
      id: `ts-${name}`,
      rank,
      schoolName: name,
      highSchoolId: master ? 'hs-1' : null,
      reason: null,
      updatedAt: '2026-09-01T00:00:00Z',
      master: master
        ? {
            prefecture: '東京都',
            schoolName: name,
            course: '',
            category: '普通科',
            naishin: 49,
            naishinMax: 65,
            hensachi: 55,
            sourceLabel: 'Vもぎ 2025年9月版',
            verifiedAt: null,
            accessLines: [],
            ...master,
          }
        : null,
    } as TargetSchoolRow;
  }

  it('★小川 華佳さん（狛江・内申53 vs 49・偏差値54 vs 55・東京）', () => {
    const lines = buildTargetSchoolTalkLines([school('狛江', {})], 53, 54, 'tokyo');
    expect(lines).toEqual([
      { kind: 'say', text: '狛江：内申はめやすを4上回っている。推薦も一般も内申が武器になる' },
      { kind: 'say', text: '偏差値はめやすまであと1。次の模試で届く幅かを一緒に見る' },
      { kind: 'ask', text: '狛江の推薦を受けるか聞く' },
    ]);
  });

  it('両方プラスなら「安全圏。上の学校を狙うか」を聞く', () => {
    const lines = buildTargetSchoolTalkLines([school('狛江', {})], 52, 58, 'tokyo');
    expect(lines[1]).toEqual({ kind: 'say', text: '偏差値もめやすを3上回っている。このまま維持' });
    expect(lines[2]).toEqual({
      kind: 'ask',
      text: '狛江は第1志望として安全圏。上の学校を狙うかを聞く',
    });
  });

  it('★内申が足りないときは東京だけ「換算内申1点＝当日約3点」を添える（scenes.ts と同じ文）', () => {
    const tokyo = buildTargetSchoolTalkLines([school('狛江', {})], 46, 57, 'tokyo');
    expect(tokyo[0].text).toBe(
      '狛江：内申がめやすに3届かない。当日の点で取り返す（換算内申1点は当日の素点で約3点ぶん）'
    );
    expect(tokyo[1].text).toBe('偏差値はめやすを2上回っている。このまま維持');
    expect(tokyo[2]).toEqual({ kind: 'say', text: '狛江は一般入試の当日点で勝負する形になる' });
  });

  it('★神奈川は中立な比較だけ（換算内申の比・推薦の言葉を出さない）', () => {
    const plus = buildTargetSchoolTalkLines([school('希望ケ丘', {})], 53, 54, 'kanagawa');
    const minus = buildTargetSchoolTalkLines([school('希望ケ丘', {})], 46, 57, 'kanagawa');
    const all = [...plus, ...minus].map((l) => l.text).join('\n');
    expect(all).not.toContain('推薦');
    expect(all).not.toContain('換算内申');
    expect(plus.map((l) => l.text)).toEqual([
      '希望ケ丘：内申はめやすを4上回っている。内申が武器になる',
      '偏差値はめやすまであと1。次の模試で届く幅かを一緒に見る',
    ]);
    expect(minus[2].text).toBe('希望ケ丘は当日の学力検査で勝負する形になる');
  });

  it('都県が分からない教室も中立な形に倒す', () => {
    const text = buildTargetSchoolTalkLines([school('狛江', {})], 53, 54, null)
      .map((l) => l.text)
      .join('\n');
    expect(text).not.toContain('推薦');
  });

  it('めやすちょうどのとき', () => {
    const lines = buildTargetSchoolTalkLines([school('狛江', {})], 49, 55, 'tokyo');
    expect(lines.map((l) => l.text)).toEqual([
      '狛江：内申はめやすちょうど',
      '偏差値はめやすちょうど',
    ]);
  });

  it('マスタに当たらない・本人の材料が無いときは1行だけ', () => {
    expect(buildTargetSchoolTalkLines([school('私立A', null)], 53, 54, 'tokyo')).toEqual([
      { kind: 'say', text: '私立A：めやすと比べる材料が無い（内申・模試を聞いて入れる）' },
    ]);
    expect(buildTargetSchoolTalkLines([school('狛江', {})], null, null, 'tokyo')).toEqual([
      { kind: 'say', text: '狛江：めやすと比べる材料が無い（内申・模試を聞いて入れる）' },
    ]);
  });

  it('★満点が65でない学校は内申の話をしない（右の志望校の行と同じ規則）', () => {
    const lines = buildTargetSchoolTalkLines(
      [school('駒場', { naishin: 55, naishinMax: 75 })],
      41,
      54,
      'tokyo'
    );
    expect(lines).toEqual([
      { kind: 'say', text: '駒場：偏差値はめやすまであと1。次の模試で届く幅かを一緒に見る' },
    ]);
  });

  it('偏差値だけあるときは学校名を偏差値の行に付ける', () => {
    const lines = buildTargetSchoolTalkLines([school('狛江', {})], null, 57, 'tokyo');
    expect(lines).toEqual([
      { kind: 'say', text: '狛江：偏差値はめやすを2上回っている。このまま維持' },
    ]);
  });
});

/* ============================================================
 * 神奈川県立の志望校（135点満点の内申）
 * 正典: docs/interview-workspace-layout-2026-09.md §「神奈川県立の志望校」
 * ========================================================== */

describe('神奈川県立の志望校（基準内申 n/135）', () => {
  const NINE = [
    'english',
    'math',
    'japanese',
    'social',
    'science',
    'music',
    'art',
    'tech_home',
    'pe',
  ] as const;

  /** 通知表1件。9教科を同じ値で埋める */
  function reportCard(grade: number, nameCode: string, v: number): AssessmentWithScores {
    return {
      category: 'report_card',
      grade,
      name_code: nameCode,
      scores: NINE.map((subject) => ({ subject, value: v })),
    } as unknown as AssessmentWithScores;
  }
  const mock = (h: number) =>
    ({
      category: 'mock',
      name_code: 'classroom',
      grade: 9,
      scores: [{ subject: 'hensa_5', value: h }],
    }) as unknown as AssessmentWithScores;

  function kanagawaSchool(overrides: Partial<TargetSchoolMaster> = {}): TargetSchoolRow {
    return {
      id: 'ts-k',
      rank: 1,
      schoolName: '光陵',
      highSchoolId: 'hs-k',
      reason: null,
      updatedAt: '2026-09-01T00:00:00Z',
      master: {
        prefecture: '神奈川県',
        schoolName: '光陵',
        course: '',
        category: '普通科',
        naishin: 107,
        naishinMax: 135,
        hensachi: 60,
        sourceLabel: '合格基準一覧表 2026年度',
        verifiedAt: null,
        accessLines: [],
        ...overrides,
      },
    };
  }
  function tokyoSchool(): TargetSchoolRow {
    return {
      id: 'ts-t',
      rank: 2,
      schoolName: '狛江',
      highSchoolId: 'hs-t',
      reason: null,
      updatedAt: '2026-09-01T00:00:00Z',
      master: {
        prefecture: '東京都',
        schoolName: '狛江',
        course: '',
        category: '普通科',
        naishin: 49,
        naishinMax: 65,
        hensachi: 55,
        sourceLabel: 'Vもぎ 2025年9月版',
        verifiedAt: null,
        accessLines: [],
      },
    };
  }

  // 新しい順（中3 2学期 → 中2学年末）。中2=4×9=36・中3=4×9=36 → 36+72=108
  const confirmed = [reportCard(9, 'term2', 4), reportCard(8, 'year_end', 4), mock(58)];
  // 中3が1学期だけ。中2=3×9=27・中3=4×9=36 → 27+72=99
  const provisional = [reportCard(9, 'term1', 4), reportCard(8, 'year_end', 3), mock(58)];

  describe('latestOwnKanagawaNaishin', () => {
    it('中2学年末と中3の2学期から135点満点で出す', () => {
      expect(latestOwnKanagawaNaishin(confirmed)).toMatchObject({
        converted: 108,
        provisional: false,
      });
    });

    it('中3が1学期だけなら仮計算', () => {
      expect(latestOwnKanagawaNaishin(provisional)).toMatchObject({
        converted: 99,
        provisional: true,
      });
    });

    it('★中3に2学期と1学期の両方があれば2学期を使う（新しさより入試に使う評定）', () => {
      const r = latestOwnKanagawaNaishin([
        reportCard(9, 'term1', 5),
        reportCard(9, 'term2', 3),
        reportCard(8, 'year_end', 3),
      ]);
      expect(r).toMatchObject({ converted: 27 + 54, provisional: false });
    });

    it('★中3の学年末があっても2学期を使う（学年末は入試のあとの評定）', () => {
      const r = latestOwnKanagawaNaishin([
        reportCard(9, 'year_end', 5),
        reportCard(9, 'term2', 3),
        reportCard(8, 'year_end', 3),
      ]);
      expect(r?.converted).toBe(27 + 54);
    });

    it('2期制は中2の後期（second）を学年末として使う', () => {
      const r = latestOwnKanagawaNaishin([reportCard(9, 'second', 4), reportCard(8, 'second', 3)]);
      expect(r).toMatchObject({ converted: 27 + 72, provisional: false });
    });

    it('中2の学年末でない通知表（1学期・前期）だけなら null', () => {
      expect(
        latestOwnKanagawaNaishin([reportCard(9, 'term2', 4), reportCard(8, 'term1', 4)])
      ).toBeNull();
      expect(
        latestOwnKanagawaNaishin([reportCard(9, 'term2', 4), reportCard(8, 'first', 4)])
      ).toBeNull();
    });

    it('中3が無い／中2が無いなら null', () => {
      expect(latestOwnKanagawaNaishin([reportCard(8, 'year_end', 4)])).toBeNull();
      expect(latestOwnKanagawaNaishin([reportCard(9, 'term2', 4)])).toBeNull();
      expect(latestOwnKanagawaNaishin([])).toBeNull();
    });
  });

  describe('buildTargetSchoolGapLines（④の右）', () => {
    it('基準内申n/135と本人の値・差を並べ、偏差値は基準偏差値と呼ぶ', () => {
      const { tell } = buildTargetSchoolGapLines([kanagawaSchool()], confirmed);
      expect(tell[0]).toBe(
        '第1 光陵 ／ めやす 基準内申107/135（本人 108・+1）・基準偏差値60（-2）' +
          '（合格基準一覧表 2026年度／原本との突き合わせは未了）'
      );
    });

    it('★「合格可能性60%の位置」は Vもぎ（都立）の定義なので神奈川には付けない', () => {
      const { tell } = buildTargetSchoolGapLines([kanagawaSchool()], confirmed);
      expect(tell[0]).not.toContain('合格可能性60%');
    });

    it('中3が1学期だけなら仮計算と添える', () => {
      const { tell } = buildTargetSchoolGapLines([kanagawaSchool()], provisional);
      expect(tell[0]).toContain('基準内申107/135（本人 99・-8）（中3は1学期の評定で仮計算）');
    });

    it('本人の内申が出せなければ、めやすだけ分母つきで出す（65点満点の数字と引かない）', () => {
      // 中3の通知表しか無い＝都立の換算内申は出せるが、神奈川の内申は出せない
      const { tell } = buildTargetSchoolGapLines(
        [kanagawaSchool()],
        [reportCard(9, 'term2', 4), mock(58)]
      );
      expect(tell[0]).toContain('めやす 基準内申107/135・基準偏差値60（-2）');
      expect(tell[0]).not.toContain('107/135（');
    });

    it('内申が空の16校（naishin_max も空）でも神奈川の語で出す', () => {
      const { tell } = buildTargetSchoolGapLines(
        [kanagawaSchool({ naishin: null, naishinMax: null })],
        confirmed
      );
      expect(tell[0]).toContain('めやす 基準偏差値60（-2）');
      expect(tell[0]).not.toContain('必要');
    });

    it('沿線があれば出す・無ければ出さない', () => {
      expect(
        buildTargetSchoolGapLines([kanagawaSchool({ accessLines: ['相鉄線'] })], confirmed).tell[0]
      ).toContain('沿線: 相鉄線');
      expect(buildTargetSchoolGapLines([kanagawaSchool()], confirmed).tell[0]).not.toContain(
        '沿線'
      );
    });

    it('★都立と神奈川県立を並べても、それぞれの満点の本人の内申で比べる', () => {
      const { tell } = buildTargetSchoolGapLines([kanagawaSchool(), tokyoSchool()], confirmed);
      expect(tell[0]).toContain('基準内申107/135（本人 108・+1）');
      // 都立は直近の通知表（中3 2学期・オール4）の換算内申 20+16×2=52 → 52-49=+3
      expect(tell[1]).toContain('必要内申49（+3）');
      expect(tell[1]).toContain('合格可能性60%の位置');
    });
  });

  describe('buildTargetSchoolTalkLines（④の左）', () => {
    it('神奈川の教室・神奈川県立は中立な言い方で数字を使う', () => {
      const lines = buildTargetSchoolTalkLines(
        [kanagawaSchool()],
        latestOwnNaishin(confirmed),
        58,
        'kanagawa',
        latestOwnKanagawaNaishin(confirmed)
      );
      expect(lines.map((l) => l.text)).toEqual([
        '光陵：内申はめやすを1上回っている。内申が武器になる',
        '偏差値はめやすまであと2。次の模試で届く幅かを一緒に見る',
      ]);
    });

    it('仮計算なら内申の行に（仮計算）を添える', () => {
      const lines = buildTargetSchoolTalkLines(
        [kanagawaSchool()],
        latestOwnNaishin(provisional),
        58,
        'kanagawa',
        latestOwnKanagawaNaishin(provisional)
      );
      expect(lines[0].text).toBe('光陵：内申がめやすに8届かない（仮計算）。当日の点で取り返す');
    });

    it('★東京の教室の生徒が神奈川県立を志望しても、推薦・換算内申の話をしない', () => {
      const lines = buildTargetSchoolTalkLines(
        [kanagawaSchool()],
        latestOwnNaishin(confirmed),
        61,
        'tokyo',
        latestOwnKanagawaNaishin(confirmed)
      );
      const text = lines.map((l) => l.text).join('\n');
      expect(text).not.toContain('推薦');
      expect(text).not.toContain('換算内申');
      expect(lines[0].text).toBe('光陵：内申はめやすを1上回っている。内申が武器になる');
    });

    it('★神奈川の本人の内申を渡さなければ、65点満点の数字で神奈川県立と比べない', () => {
      const lines = buildTargetSchoolTalkLines([kanagawaSchool()], 52, null, 'kanagawa');
      expect(lines).toEqual([
        { kind: 'say', text: '光陵：めやすと比べる材料が無い（内申・模試を聞いて入れる）' },
      ]);
    });
  });

  it('formatNaishin: 135点満点は「基準内申」と呼ぶ（東京は従来どおり「必要内申」）', () => {
    expect(formatNaishin(107, 135)).toBe('基準内申107/135');
    expect(formatNaishin(null, 135)).toBe('基準内申は未設定');
    expect(formatNaishin(107, 135, '内申')).toBe('内申107/135');
    expect(formatNaishin(45, 65)).toBe('必要内申45');
  });
});
