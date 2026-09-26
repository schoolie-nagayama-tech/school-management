/**
 * 成績未入力(score_missing)アラートと「テストなし」のテスト
 *
 * 美術のテストが無い回などは「テストなし」（assessment_scores.no_test）で持つ。
 * それまではアラートを消すために 0 を入れていた。ここでは
 *  (1) テストなしの科目は入力済みと数え、アラートに出さないこと
 *  (2) 値もテストなしも無い科目は従来どおり未入力として出すこと
 *  (3) 全科目が空の未使用レコードは従来どおり出さないこと
 * を固定する。
 */
import { describe, it, expect, vi } from 'vitest';

// 評価関数は純粋だが alerts.ts が supabase クライアントを import するため、生成だけ差し替える。
vi.mock('@/lib/supabase', () => {
  const client = { from: vi.fn() };
  return {
    supabase: client,
    getSupabaseBrowserClient: () => client,
    createSupabaseBrowserClient: () => client,
  };
});

import { ALERT_DEFINITIONS, type AlertSources } from '@/lib/api/alerts';

const STUDENT = {
  id: 'stu-1',
  last_name: '山田',
  first_name: '花子',
  grade: 8,
  school_id: 'school-1',
};

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
];

type ScoreFixture = { subject: string; value: number | null; no_test?: boolean };

function makeSources(scores: ScoreFixture[]): AlertSources {
  const assessment = {
    id: 'a-1',
    student_id: STUDENT.id,
    school_id: STUDENT.school_id,
    category: 'regular_test',
    name_code: 'term2_final',
    title: '2学期期末',
    grade: 8,
    exam_month: '2026-12-01',
    scores: scores.map((s, i) => ({
      id: `s-${i}`,
      assessment_id: 'a-1',
      created_at: '2026-12-01T00:00:00Z',
      ...s,
    })),
  };
  return {
    students: [STUDENT],
    assessmentsByStudent: new Map([[STUDENT.id, [assessment]]]),
    settingsBySchool: new Map(),
  } as unknown as AlertSources;
}

const evaluate = (sources: AlertSources) => ALERT_DEFINITIONS.score_missing.evaluator(sources);

describe('score_missing（成績未入力）とテストなし', () => {
  it('テストなしの科目は入力済みと数え、アラートを出さない', () => {
    const scores = NINE.map((subject) =>
      subject === 'art'
        ? { subject, value: null, no_test: true }
        : { subject, value: 70, no_test: false }
    );
    expect(evaluate(makeSources(scores))).toEqual([]);
  });

  it('値もテストなしも無い科目は未入力として出す（テストなしの科目は含めない）', () => {
    const scores = NINE.map((subject) => {
      if (subject === 'art') return { subject, value: null, no_test: true };
      if (subject === 'music') return { subject, value: null, no_test: false };
      return { subject, value: 70 };
    });
    const alerts = evaluate(makeSources(scores));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].details).toEqual({ subject: 'music' });
  });

  it('全科目が空の未使用レコードは出さない（従来どおり）', () => {
    const scores = NINE.map((subject) => ({ subject, value: null }));
    expect(evaluate(makeSources(scores))).toEqual([]);
  });

  it('全科目がテストなしでも、未入力は無いのでアラートは出ない', () => {
    const scores = NINE.map((subject) => ({ subject, value: null, no_test: true }));
    expect(evaluate(makeSources(scores))).toEqual([]);
  });
});
