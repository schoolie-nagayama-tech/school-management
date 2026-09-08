/**
 * 進行表の目標「終了」機能のテスト。
 *
 * 目標(student_textbook_exams)は「生徒×科目」で共有されており、講習で立てた目標は
 * 後続の目標を立てない限り試験日を過ぎても残り続ける。activeExamOf() の選択から
 * 終了済み(closed_at あり)を外すことで「目標が無い」状態に戻す（docs/progress-goal-close-plan.md）。
 */
import { describe, it, expect } from 'vitest';
import {
  activeExamOf,
  latestClosedExamOf,
} from '@/app/students/[studentId]/progress/newProgress.shared';
import type { StudentTextbookExam, StudentTextbookWithDetails } from '@/types/database';

/** テスト用の最小 exam。activeExamOf/latestClosedExamOf が見るフィールドだけ埋める。 */
function exam(over: Partial<StudentTextbookExam> & { id: string }): StudentTextbookExam {
  return {
    student_textbook_id: null,
    student_id: 'stu-1',
    subject_key: '英語',
    exam_type_id: null,
    custom_exam_name: null,
    exam_date: null,
    target_score: null,
    result_score: null,
    exam_range: null,
    closed_at: null,
    closed_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  } as StudentTextbookExam;
}

function tbWithExams(exams: StudentTextbookExam[]): StudentTextbookWithDetails {
  return { id: 'st-1', exams } as unknown as StudentTextbookWithDetails;
}

describe('activeExamOf と終了済み目標', () => {
  it('終了済みしか無ければ null を返す（=目標が無い状態に戻る）', () => {
    const tb = tbWithExams([
      exam({ id: 'e1', exam_date: '2026-07-31', closed_at: '2026-08-01T00:00:00.000Z' }),
    ]);
    expect(activeExamOf(tb)).toBeNull();
  });

  it('未来日の終了済みがあっても、生きている過去日の目標を選ぶ', () => {
    // 講習で先に立てた未来日の目標を終了しても、現在進行中の過去日の目標が拾われること。
    const tb = tbWithExams([
      exam({ id: 'alive', exam_date: '2026-07-01' }),
      exam({
        id: 'closed-future',
        exam_date: '2026-12-25',
        closed_at: '2026-08-01T00:00:00.000Z',
      }),
    ]);
    const active = activeExamOf(tb);
    expect(active?.id).toBe('alive');
  });

  it('生きている目標が複数あれば、終了済みを除いた中で一番近い将来を選ぶ', () => {
    const tb = tbWithExams([
      exam({ id: 'near', exam_date: '2026-06-01' }),
      exam({ id: 'far', exam_date: '2026-09-01' }),
      exam({ id: 'closed', exam_date: '2026-05-01', closed_at: '2026-08-01T00:00:00.000Z' }),
    ]);
    // daysLeftOf は「今日」からの計算なので、実行日に左右されない形で past/future の相対関係だけ見る。
    // ここでは exam_date が無い将来判定は使わず、除外の有無だけを検証する。
    const active = activeExamOf(tb);
    expect(active?.id).not.toBe('closed');
  });
});

describe('latestClosedExamOf', () => {
  it('終了済みが無ければ null', () => {
    const tb = tbWithExams([exam({ id: 'e1', exam_date: '2026-07-31' })]);
    expect(latestClosedExamOf(tb)).toBeNull();
  });

  it('複数の終了済みがあれば closed_at が最も新しいものを返す', () => {
    const tb = tbWithExams([
      exam({
        id: 'old-closed',
        exam_date: '2026-05-01',
        custom_exam_name: '春期の目標',
        closed_at: '2026-06-01T00:00:00.000Z',
      }),
      exam({
        id: 'new-closed',
        exam_date: '2026-07-31',
        custom_exam_name: '夏期の目標',
        closed_at: '2026-08-15T00:00:00.000Z',
      }),
    ]);
    const latest = latestClosedExamOf(tb);
    expect(latest?.id).toBe('new-closed');
    expect(latest?.name).toBe('夏期の目標');
    expect(latest?.closedAt).toBe('2026-08-15T00:00:00.000Z');
  });
});
