import { describe, it, expect } from 'vitest';
import {
  addDays,
  buildHomeworkDateRows,
  compactHomeworkRows,
  computeExamCountdown,
  diffDays,
  formatCountdownDays,
  judgeCheckTestPassed,
  MAX_HOMEWORK_ROWS,
  mergeHomeworkRows,
  todayInJst,
} from '@/lib/lesson-reports/reportSchedule';

describe('日付ヘルパー', () => {
  it('diffDays は月跨ぎでも日数を正しく返す', () => {
    expect(diffDays('2026-08-01', '2026-07-31')).toBe(1);
    expect(diffDays('2026-07-29', '2026-07-15')).toBe(14);
    expect(diffDays('2026-07-15', '2026-07-29')).toBe(-14);
    expect(diffDays('2026-07-15', '2026-07-15')).toBe(0);
  });

  it('diffDays は不正な日付で null', () => {
    expect(diffDays('', '2026-07-15')).toBeNull();
    expect(diffDays('not-a-date', '2026-07-15')).toBeNull();
  });

  it('addDays は月末・年末を跨げる', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('todayInJst は UTC 深夜でも JST の日付を返す', () => {
    // 2026-07-14T16:00:00Z = 2026-07-15 01:00 JST → JST では 7/15
    expect(todayInJst(new Date('2026-07-14T16:00:00Z'))).toBe('2026-07-15');
    // 2026-07-14T14:59:00Z = 2026-07-14 23:59 JST → まだ 7/14
    expect(todayInJst(new Date('2026-07-14T14:59:00Z'))).toBe('2026-07-14');
  });
});

describe('computeExamCountdown', () => {
  const lessonDates = [
    '2026-07-16', // 未来
    '2026-07-21',
    '2026-07-23',
    '2026-07-28',
    '2026-07-30', // 試験日より後
    '2026-07-10', // 過去
  ];

  it('試験目標が無い生徒は null（カウントダウン非表示）', () => {
    expect(computeExamCountdown({ examDate: null, today: '2026-07-15', lessonDates })).toBeNull();
    expect(computeExamCountdown({ examDate: '', today: '2026-07-15', lessonDates })).toBeNull();
    expect(
      computeExamCountdown({ examDate: undefined, today: '2026-07-15', lessonDates })
    ).toBeNull();
  });

  it('14日先の試験は「あと14日・2週間」、授業回数は今日〜試験日で数える', () => {
    const cd = computeExamCountdown({ examDate: '2026-07-29', today: '2026-07-15', lessonDates });
    expect(cd).not.toBeNull();
    expect(cd!.daysLeft).toBe(14);
    expect(cd!.weeksLeft).toBe(2);
    // 7/16, 7/21, 7/23, 7/28 の4回。7/30(試験後) と 7/10(過去) は数えない
    expect(cd!.lessonsLeft).toBe(4);
    expect(cd!.expired).toBe(false);
  });

  it('境界: 試験当日は あと0日・期限切れではない', () => {
    const cd = computeExamCountdown({
      examDate: '2026-07-15',
      today: '2026-07-15',
      lessonDates: ['2026-07-15'],
    });
    expect(cd!.daysLeft).toBe(0);
    expect(cd!.weeksLeft).toBe(0);
    expect(cd!.expired).toBe(false);
    // 当日の授業は「残り」に含める
    expect(cd!.lessonsLeft).toBe(1);
  });

  it('境界: 試験日が過去なら expired・残り授業は数えない', () => {
    const cd = computeExamCountdown({
      examDate: '2026-07-10',
      today: '2026-07-15',
      lessonDates,
    });
    expect(cd!.daysLeft).toBe(-5);
    expect(cd!.expired).toBe(true);
    expect(cd!.lessonsLeft).toBe(0);
    expect(cd!.weeksLeft).toBe(0);
  });

  it('週数は切り捨て（13日→1週間 / 6日→0週間）', () => {
    expect(
      computeExamCountdown({ examDate: '2026-07-28', today: '2026-07-15', lessonDates: [] })!
        .weeksLeft
    ).toBe(1);
    expect(
      computeExamCountdown({ examDate: '2026-07-21', today: '2026-07-15', lessonDates: [] })!
        .weeksLeft
    ).toBe(0);
  });

  it('授業予定が無ければ 授業あと0回', () => {
    const cd = computeExamCountdown({ examDate: '2026-07-29', today: '2026-07-15', lessonDates: [] });
    expect(cd!.lessonsLeft).toBe(0);
  });

  it('formatCountdownDays の表示文言', () => {
    expect(
      formatCountdownDays({ daysLeft: 14, weeksLeft: 2, lessonsLeft: 4, expired: false })
    ).toBe('あと14日（2週間）');
    expect(formatCountdownDays({ daysLeft: 3, weeksLeft: 0, lessonsLeft: 1, expired: false })).toBe(
      'あと3日'
    );
    expect(formatCountdownDays({ daysLeft: 0, weeksLeft: 0, lessonsLeft: 1, expired: false })).toBe(
      'あと0日（今日）'
    );
    expect(formatCountdownDays({ daysLeft: -5, weeksLeft: 0, lessonsLeft: 0, expired: true })).toBe(
      '期限切れ（5日前）'
    );
  });
});

describe('buildHomeworkDateRows', () => {
  it('授業翌日〜次回授業日（次回授業日の行も含む）', () => {
    const rows = buildHomeworkDateRows({
      lessonDate: '2026-07-14',
      nextLessonDate: '2026-07-18',
    });
    expect(rows).toEqual(['2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18']);
  });

  it('次回授業日が翌日なら1行だけ', () => {
    const rows = buildHomeworkDateRows({ lessonDate: '2026-07-14', nextLessonDate: '2026-07-15' });
    expect(rows).toEqual(['2026-07-15']);
  });

  it('次回授業日が無ければ 翌日から7日分にフォールバック', () => {
    const rows = buildHomeworkDateRows({ lessonDate: '2026-07-14', nextLessonDate: null });
    expect(rows).toHaveLength(7);
    expect(rows[0]).toBe('2026-07-15');
    expect(rows[6]).toBe('2026-07-21');
  });

  it('次回授業日が授業日以前（不正データ）でもフォールバックする', () => {
    const rows = buildHomeworkDateRows({ lessonDate: '2026-07-14', nextLessonDate: '2026-07-10' });
    expect(rows).toHaveLength(7);
    expect(rows[0]).toBe('2026-07-15');
    // 同日もフォールバック扱い（翌日以降が対象のため）
    expect(buildHomeworkDateRows({ lessonDate: '2026-07-14', nextLessonDate: '2026-07-14' })).toHaveLength(7);
  });

  it('長期休みで次回が遠い場合は上限で打ち切り、次回授業日の行は必ず残す', () => {
    const rows = buildHomeworkDateRows({
      lessonDate: '2026-07-14',
      nextLessonDate: '2026-08-20', // 37日先
    });
    expect(rows).toHaveLength(MAX_HOMEWORK_ROWS);
    expect(rows[0]).toBe('2026-07-15');
    expect(rows[rows.length - 1]).toBe('2026-08-20');
  });

  it('授業日が空なら行を作らない', () => {
    expect(buildHomeworkDateRows({ lessonDate: '', nextLessonDate: '2026-07-18' })).toEqual([]);
  });

  it('月跨ぎでも連続する', () => {
    const rows = buildHomeworkDateRows({ lessonDate: '2026-07-30', nextLessonDate: '2026-08-02' });
    expect(rows).toEqual(['2026-07-31', '2026-08-01', '2026-08-02']);
  });
});

describe('mergeHomeworkRows / compactHomeworkRows', () => {
  it('既存の入力を日付一致で引き継ぐ', () => {
    const rows = mergeHomeworkRows(
      ['2026-07-15', '2026-07-16', '2026-07-17'],
      [{ date: '2026-07-16', text: 'ワーク p.30' }]
    );
    expect(rows).toEqual([
      { date: '2026-07-15', text: '' },
      { date: '2026-07-16', text: 'ワーク p.30' },
      { date: '2026-07-17', text: '' },
    ]);
  });

  it('生成範囲外の既存入力は末尾に残して消さない', () => {
    const rows = mergeHomeworkRows(
      ['2026-07-15'],
      [
        { date: '2026-07-25', text: '範囲外だが書いてある' },
        { date: '2026-07-26', text: '   ' }, // 空白のみは残さない
      ]
    );
    expect(rows).toEqual([
      { date: '2026-07-15', text: '' },
      { date: '2026-07-25', text: '範囲外だが書いてある' },
    ]);
  });

  it('compact は空欄の日を保存対象から外し、前後の空白を落とす', () => {
    expect(
      compactHomeworkRows([
        { date: '2026-07-15', text: '' },
        { date: '2026-07-16', text: '  ワーク p.30  ' },
        { date: '2026-07-17', text: '   ' },
      ])
    ).toEqual([{ date: '2026-07-16', text: 'ワーク p.30' }]);
  });
});

describe('judgeCheckTestPassed', () => {
  it('70%以上で合格', () => {
    expect(judgeCheckTestPassed(7, 10)).toBe(true);
    expect(judgeCheckTestPassed(15, 20)).toBe(true);
    expect(judgeCheckTestPassed(10, 10)).toBe(true);
  });

  it('70%未満で不合格', () => {
    expect(judgeCheckTestPassed(6, 10)).toBe(false);
    expect(judgeCheckTestPassed(0, 10)).toBe(false);
  });

  it('未入力・満点0は判定不能で null', () => {
    expect(judgeCheckTestPassed(null, 10)).toBeNull();
    expect(judgeCheckTestPassed(7, null)).toBeNull();
    expect(judgeCheckTestPassed(null, null)).toBeNull();
    expect(judgeCheckTestPassed(7, 0)).toBeNull();
    expect(judgeCheckTestPassed(7, -1)).toBeNull();
  });
});
