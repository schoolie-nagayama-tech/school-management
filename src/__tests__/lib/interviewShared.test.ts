import { describe, it, expect } from 'vitest';
import {
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
  GOAL_SUBJECT_TO_ASSESSMENT_SUBJECT,
  GOAL_EXAM_NAME_TO_ASSESSMENT_NAME_CODE,
  type ExamGoalForAchievement,
} from '@/app/interview/interview.shared';
import type {
  AssessmentWithScores,
  CurriculumItemWithProgress,
  StudentTextbookWithDetails,
} from '@/types/database';
import type { ScheduleRegularPattern } from '@/types/schedule';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';
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
    expect(tell[0]).toContain('第1志望 清瀬');
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

  it('マスタに当たっていない（私立など）志望校は出さない', () => {
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
    expect(tell).toEqual([]);
    expect(ask).toEqual([]);
  });

  it('本人の内申・偏差値がどちらも取れないときは出さない', () => {
    const schools = [targetSchool({ naishin: 45, naishinMax: 65, hensachi: 51 })];
    const { tell } = buildTargetSchoolGapLines(schools, []);
    expect(tell).toEqual([]);
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
