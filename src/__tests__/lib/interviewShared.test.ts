import { describe, it, expect } from 'vitest';
import {
  extractHandover,
  formatKoushuEnrollments,
  formatRegularPatternsSchedule,
  computeScoreSummary,
} from '@/app/interview/interview.shared';
import type { AssessmentWithScores } from '@/types/database';
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
});
