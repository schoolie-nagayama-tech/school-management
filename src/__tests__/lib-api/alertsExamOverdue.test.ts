/**
 * 目標未設定(exam_overdue)アラートのテスト
 *
 * 「次の目標へ」で先に進むと前の目標行はそのまま残るため、テキストごとに
 * 最新の試験日の目標だけを判定する。古い行が永久にアラートを出し続けないことを固定する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  last_name: '野中',
  first_name: '架音',
  grade: 6,
  school_id: 'school-1',
};

type ExamFixture = {
  id: string;
  exam_date: string | null;
  target_score: number | null;
  custom_exam_name?: string | null;
};

/** 1生徒・1テキストぶんの最小 AlertSources を組み立てる */
function makeSources(exams: ExamFixture[], actionGoalExamIds: string[] = []): AlertSources {
  return {
    students: [STUDENT],
    textbooksByStudent: new Map([
      [
        STUDENT.id,
        [
          {
            id: 'st-1',
            textbook: { name: '読解博士基礎編' },
            exams: exams.map((e) => ({ exam_type_id: null, custom_exam_name: null, ...e })),
          },
        ],
      ],
    ]),
    examTypeNames: new Map(),
    actionGoalExamIds: new Set(actionGoalExamIds),
    settingsBySchool: new Map(),
  } as unknown as AlertSources;
}

const evaluate = (sources: AlertSources) => ALERT_DEFINITIONS.exam_overdue.evaluator(sources);

describe('exam_overdue（目標未設定）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 21, 12, 0, 0)); // 2026-08-21 ローカル正午
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('試験日を過ぎて目標点も行動目標も無ければアラートを出す', () => {
    const alerts = evaluate(
      makeSources([{ id: 'e1', exam_date: '2026-07-31', target_score: null }])
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].details?.exam_id).toBe('e1');
  });

  it('目標点があればアラートを出さない', () => {
    expect(
      evaluate(makeSources([{ id: 'e1', exam_date: '2026-07-31', target_score: 80 }]))
    ).toEqual([]);
  });

  it('行動目標があればアラートを出さない', () => {
    expect(
      evaluate(makeSources([{ id: 'e1', exam_date: '2026-07-31', target_score: null }], ['e1']))
    ).toEqual([]);
  });

  it('より新しい目標に進んでいれば、古い未設定の行はアラートを出さない', () => {
    const alerts = evaluate(
      makeSources(
        [
          { id: 'old', exam_date: '2026-07-31', target_score: null }, // 次の目標へ進む前の行
          { id: 'new', exam_date: '2026-09-30', target_score: 80 }, // 設定済みの次の目標
        ],
        ['new']
      )
    );
    expect(alerts).toEqual([]);
  });

  it('最新の目標自体が未設定で試験日を過ぎていればアラートを出す（古い行は出さない）', () => {
    const alerts = evaluate(
      makeSources([
        { id: 'old', exam_date: '2026-06-30', target_score: null },
        { id: 'latest', exam_date: '2026-07-31', target_score: null },
      ])
    );
    expect(alerts.map((a) => a.details?.exam_id)).toEqual(['latest']);
  });

  it('同じ試験日が並ぶ場合はどちらも最新扱いで判定する', () => {
    const alerts = evaluate(
      makeSources([
        { id: 'a', exam_date: '2026-07-31', target_score: null },
        { id: 'b', exam_date: '2026-07-31', target_score: null },
      ])
    );
    expect(alerts.map((a) => a.details?.exam_id).sort()).toEqual(['a', 'b']);
  });

  it('試験日が未来ならアラートを出さない', () => {
    expect(
      evaluate(makeSources([{ id: 'e1', exam_date: '2026-09-30', target_score: null }]))
    ).toEqual([]);
  });
});
