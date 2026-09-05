/**
 * 目標未設定(exam_overdue)アラートのテスト
 *
 * 目標(student_textbook_exams)の親は「生徒×テキスト」ではなく「生徒×科目」。
 * 読み込み層が同じ科目の全テキストへ同じ目標配列を hydrate するため、buildExamOverdueCandidates
 * はテキストをループしても同じ exam を複数回見ることになる。ここでは
 * (1) 「次の目標へ」で先に進むと前の目標行が残っても永久にアラートを出し続けないこと、
 * (2) 同じ科目の複数テキストがあってもアラートが重複しないこと、の2つを固定する。
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

/**
 * 1生徒ぶんの最小 AlertSources を組み立てる。
 * textbookCount で「同じ科目のテキストが何冊あるか」を指定する（既定1冊）。
 * 読み込み層のhydrateと同じく、全テキストが同じ exams 配列を共有する形にする。
 */
function makeSources(
  exams: ExamFixture[],
  actionGoalExamIds: string[] = [],
  textbookCount = 1
): AlertSources {
  const hydratedExams = exams.map((e) => ({ exam_type_id: null, custom_exam_name: null, ...e }));
  const textbooks = Array.from({ length: textbookCount }, (_, i) => ({
    id: `st-${i + 1}`,
    // 科目は「国語」で揃える（categorizeSubject が同じ列に分類する前提のテスト用）
    textbook: { name: `読解博士基礎編${i + 1}`, subject: '国語' },
    exams: hydratedExams,
  }));
  return {
    students: [STUDENT],
    textbooksByStudent: new Map([[STUDENT.id, textbooks]]),
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

  it('同じ科目に2冊テキストがあっても、同じ目標のアラートは1件にまとめる', () => {
    // 読み込み層が科目単位で exams を hydrate するため、同じ科目の2テキストは
    // 同じ exam.id を持つ。テキストごとにループしても重複して出さないことを確認する。
    const alerts = evaluate(
      makeSources([{ id: 'e1', exam_date: '2026-07-31', target_score: null }], [], 2)
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].details?.exam_id).toBe('e1');
  });

  it('メッセージ・詳細のテキスト名相当は科目名になる（複数テキストにまたがるため特定の教材名は出さない）', () => {
    const alerts = evaluate(
      makeSources([{ id: 'e1', exam_date: '2026-07-31', target_score: null }], [], 2)
    );
    expect(alerts[0].message).toContain('国語');
    expect(alerts[0].details?.textbook_name).toBe('国語');
  });
});
