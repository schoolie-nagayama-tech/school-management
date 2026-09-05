/**
 * 掲示板タスクの進捗の数え方のテスト。
 *
 * ★ここで守りたいのは3点:
 *  - 判定できない種別に数字を出さないこと（出すとその数字で督促が飛ぶ）
 *  - 中学生以外を内申の母数に入れないこと
 *  - 担当が解決できない生徒を黙って消さないこと（合計が合わなくなる）
 */
import { describe, expect, it } from 'vitest';
import {
  breakdownByTeacher,
  computeTaskProgress,
  isInScope,
  isJudgeable,
  type StudentRow,
} from '@/lib/bulletin/progress';
import { REPORT_CARD_SUBJECTS } from '@/lib/bulletin/taskCatalog';

const ALL9 = [...REPORT_CARD_SUBJECTS];

function student(over: Partial<StudentRow> & { id: string }): StudentRow {
  return { grade: 8, teacherId: 't1', markedNotApplicable: false, ...over };
}

describe('判定できる種別', () => {
  it('内申入力は判定できる', () => {
    expect(isJudgeable('report_card_entry')).toBe(true);
  });

  /**
   * ★実データで判定できない種別に数字を出すと、その数字を見て督促が飛ぶ。
   * いま起きている問題（手動チェックを見て督促を4回）をそのまま再生産してしまう。
   */
  it('まだ実装していない種別は判定しない', () => {
    expect(isJudgeable('goal_setting')).toBe(false);
    expect(isJudgeable('shift_submit')).toBe(false);
  });

  it('判定できない種別は0を返し、unsupported を立てる', () => {
    const got = computeTaskProgress({
      kind: 'goal_setting',
      scope: 'all_students',
      targetGrades: [],
      targetStudentIds: [],
      students: [student({ id: 'a' })],
    });
    expect(got).toMatchObject({ total: 0, done: 0, notYet: 0, unsupported: true });
    expect(got.students).toEqual([]);
  });
});

describe('対象の絞り込み', () => {
  const s = student({ id: 'a', grade: 9 });

  it('全生徒はそのまま入る', () => {
    expect(isInScope(s, 'all_students', [], [])).toBe(true);
  });

  it('学年で絞れる', () => {
    expect(isInScope(s, 'grade', [9], [])).toBe(true);
    expect(isInScope(s, 'grade', [7], [])).toBe(false);
  });

  /** ★AIが学年を取れなかったときに全員が消えると、依頼そのものが無かったことになる */
  it('学年の指定が空なら絞らない', () => {
    expect(isInScope(s, 'grade', [], [])).toBe(true);
  });

  it('名指しの生徒だけ', () => {
    expect(isInScope(s, 'specific_students', [], ['a'])).toBe(true);
    expect(isInScope(s, 'specific_students', [], ['b'])).toBe(false);
  });

  it('講師自身のタスクは生徒では数えない', () => {
    expect(isInScope(s, 'teacher_self', [], [])).toBe(false);
  });
});

describe('内申入力の進捗', () => {
  const base = {
    kind: 'report_card_entry' as const,
    scope: 'all_students' as const,
    targetGrades: [],
    targetStudentIds: [],
  };

  it('9科そろっている生徒だけ済になる', () => {
    const got = computeTaskProgress({
      ...base,
      students: [student({ id: 'a' }), student({ id: 'b' })],
      subjectsByStudent: new Map([
        ['a', ALL9],
        ['b', ALL9.slice(0, 8)],
      ]),
    });
    expect(got).toMatchObject({ total: 2, done: 1, notYet: 1 });
  });

  it('内申が1件も無ければ未済', () => {
    const got = computeTaskProgress({
      ...base,
      students: [student({ id: 'a' })],
      subjectsByStudent: new Map(),
    });
    expect(got).toMatchObject({ total: 1, done: 0, notYet: 1 });
  });

  /** ★高校生に9科の基準を当てると全員が永久に未済になる */
  it.each([[10], [11], [12]])('高校生（%i）は母数に入れない', (grade) => {
    const got = computeTaskProgress({
      ...base,
      students: [student({ id: 'a', grade })],
      subjectsByStudent: new Map(),
    });
    expect(got.total).toBe(0);
  });

  it('小学生も母数に入れない', () => {
    const got = computeTaskProgress({
      ...base,
      students: [student({ id: 'a', grade: 5 })],
      subjectsByStudent: new Map(),
    });
    expect(got.total).toBe(0);
  });

  /** ★「対象外」は人が付けた判断。属性から導かれていないので尊重する */
  it('対象外は母数から外し、別に数える', () => {
    const got = computeTaskProgress({
      ...base,
      students: [student({ id: 'a' }), student({ id: 'b', markedNotApplicable: true })],
      subjectsByStudent: new Map([['a', ALL9]]),
    });
    expect(got).toMatchObject({ total: 1, done: 1, notYet: 0, excluded: 1 });
  });
});

describe('講師別の内訳', () => {
  const progress = computeTaskProgress({
    kind: 'report_card_entry',
    scope: 'all_students',
    targetGrades: [],
    targetStudentIds: [],
    students: [
      student({ id: 'a', teacherId: 't1' }),
      student({ id: 'b', teacherId: 't1' }),
      student({ id: 'c', teacherId: 't2' }),
      // ★担当が解決できない生徒（清瀬校は座席表も固定講師も0件）
      student({ id: 'd', teacherId: null }),
      student({ id: 'e', teacherId: 't2', markedNotApplicable: true }),
    ],
    subjectsByStudent: new Map([
      ['a', ALL9],
      ['c', ALL9],
    ]),
  });

  it('合計が母数と一致する（黙って消さない）', () => {
    const rows = breakdownByTeacher(progress);
    const sum = rows.reduce((n, r) => n + r.total, 0);
    expect(sum).toBe(progress.total);
    expect(sum).toBe(4);
  });

  /** ★担当が解決できない生徒を消すと合計が合わなくなり、数字が信用されなくなる */
  it('担当が解決できない生徒も1行として出る', () => {
    const rows = breakdownByTeacher(progress);
    expect(rows.some((r) => r.teacherId === null)).toBe(true);
  });

  it('対象外は内訳に出さない', () => {
    const rows = breakdownByTeacher(progress);
    const t2 = rows.find((r) => r.teacherId === 't2');
    expect(t2?.total).toBe(1);
  });

  it('未済の多い順に並ぶ（督促はここから）', () => {
    const rows = breakdownByTeacher(progress);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].notYet).toBeGreaterThanOrEqual(rows[i].notYet);
    }
  });
});

/**
 * 種別を増やしたぶんの判定（2026-09-05）。
 *
 * ★ここで守りたいのは2点:
 *  - 定期テストを「どの回か」が決まる前に数えないこと
 *    （決め打ちで外すと、入っていない回を見て「全員済」＝最も危ない方向に誤る）
 *  - 材料が無いものを済と数えないこと
 */
describe('判定できる種別を増やしたぶん', () => {
  const mid2: StudentRow = { id: 's-mid', grade: 8, teacherId: null, markedNotApplicable: false };
  const elem: StudentRow = { id: 's-elem', grade: 4, teacherId: null, markedNotApplicable: false };

  it('定期テストは「どの回か」が決まるまで数えない', () => {
    expect(isJudgeable('test_result_entry')).toBe(false);
    expect(isJudgeable('test_result_entry', { hasTargetPeriod: false })).toBe(false);
    expect(isJudgeable('test_result_entry', { hasTargetPeriod: true })).toBe(true);
  });

  it('回が決まっていなければ unsupported を返し、人数を出さない', () => {
    const p = computeTaskProgress({
      kind: 'test_result_entry',
      scope: 'all_students',
      targetGrades: [],
      targetStudentIds: [],
      students: [mid2],
      hasTargetPeriod: false,
    });
    expect(p.unsupported).toBe(true);
    expect(p.total).toBe(0);
  });

  it('回が決まれば、点が入っている生徒を済として数える', () => {
    const p = computeTaskProgress({
      kind: 'test_result_entry',
      scope: 'all_students',
      targetGrades: [],
      targetStudentIds: [],
      students: [mid2],
      hasTargetPeriod: true,
      inputs: { testEnteredStudentIds: new Set(['s-mid']) },
    });
    expect(p.unsupported).toBe(false);
    expect(p.done).toBe(1);
    expect(p.notYet).toBe(0);
  });

  it('小学生は定期テストの母数に入れない（誰も入力しようがない人数を残さない）', () => {
    const p = computeTaskProgress({
      kind: 'test_result_entry',
      scope: 'all_students',
      targetGrades: [],
      targetStudentIds: [],
      students: [mid2, elem],
      hasTargetPeriod: true,
      inputs: { testEnteredStudentIds: new Set<string>() },
    });
    expect(p.total).toBe(1);
    expect(p.notYet).toBe(1);
  });

  it('進行表入力は、記録がある生徒だけを済にする（材料が無ければ未済）', () => {
    const p = computeTaskProgress({
      kind: 'progress_entry',
      scope: 'all_students',
      targetGrades: [],
      targetStudentIds: [],
      students: [mid2, elem],
      inputs: { progressRecordedStudentIds: new Set(['s-mid']) },
    });
    expect(p.unsupported).toBe(false);
    expect(p.done).toBe(1);
    expect(p.notYet).toBe(1);
  });

  it('進行表入力は材料そのものが無ければ全員未済（黙って済にしない）', () => {
    const p = computeTaskProgress({
      kind: 'progress_entry',
      scope: 'all_students',
      targetGrades: [],
      targetStudentIds: [],
      students: [mid2],
    });
    expect(p.done).toBe(0);
    expect(p.notYet).toBe(1);
  });

  it('判定を実装していない種別は、これまでどおり数字を出さない', () => {
    for (const kind of ['goal_setting', 'shift_submit', 'report_deadline'] as const) {
      expect(isJudgeable(kind)).toBe(false);
    }
  });
});
