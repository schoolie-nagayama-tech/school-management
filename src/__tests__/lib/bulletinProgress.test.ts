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
  resolveAttendingSchoolNames,
  type StudentRow,
  type TeacherRow,
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
    // ★教材配布は品目が分からず誤って済にする方向に弱いので足していない
    expect(isJudgeable('material_handout_check')).toBe(false);
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

/**
 * 通学校で絞る（2026-09-08）。
 *
 * ★永山校の試用で「諏訪中生は」が specific_students・target_student_ids=[] に
 *   なり、母数が0になった。「◯◯中生」は通学校であって名指しではないので、
 *   通学校で絞る scope（attending_school）を別に用意した。
 */
describe('通学校で絞る', () => {
  it('表記ゆれを吸収して一致する（「永山」と「永山中」）', () => {
    const s = student({ id: 'a', schoolName: '永山中' });
    expect(isInScope(s, 'attending_school', [], [], ['永山'])).toBe(true);
  });

  it('似ていても別の学校は一致しない（「諏訪中」と「諏訪小」）', () => {
    const s = student({ id: 'a', schoolName: '諏訪小' });
    expect(isInScope(s, 'attending_school', [], [], ['諏訪中'])).toBe(false);
  });

  it('通学校の指定が空なら絞らない', () => {
    const s = student({ id: 'a', schoolName: '永山中' });
    expect(isInScope(s, 'attending_school', [], [], [])).toBe(true);
  });

  it('通学校が未登録の生徒は一致しない', () => {
    const s = student({ id: 'a', schoolName: null });
    expect(isInScope(s, 'attending_school', [], [], ['永山'])).toBe(false);
  });

  it('正式表記（市立◯◯中学校）でも一致する', () => {
    const s = student({ id: 'a', schoolName: '永山市立永山中学校' });
    expect(isInScope(s, 'attending_school', [], [], ['永山中'])).toBe(true);
  });
});

/**
 * ★母数0で「全員済」に見えるのを防ぐ（specific_students が空のとき絞らないのと同じ考え）。
 *   表記ゆれ・入力ミスで1人も一致しないと、絞り込みをあきらめて全員を母数にする。
 *   ★この判定は在籍生徒全員を渡す進捗ボード側だけで使う（授業中ポップアップでは使わない）。
 */
describe('通学校の絞り込みで1人も一致しなければ絞らない', () => {
  const roster = [
    student({ id: 'a', schoolName: '永山中' }),
    student({ id: 'b', schoolName: '多摩中' }),
  ];

  it('1人も一致しなければ空配列（絞らない）を返す', () => {
    expect(resolveAttendingSchoolNames(roster, ['諏訪中'])).toEqual([]);
  });

  it('1人でも一致すればそのまま返す', () => {
    expect(resolveAttendingSchoolNames(roster, ['永山'])).toEqual(['永山']);
  });

  it('target が空ならそのまま空', () => {
    expect(resolveAttendingSchoolNames(roster, [])).toEqual([]);
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
    for (const kind of ['goal_setting', 'material_handout_check', 'report_deadline'] as const) {
      expect(isJudgeable(kind)).toBe(false);
    }
  });
});

/**
 * テスト対策提案の判定（2026-09-07）。
 * ★report_card_entry と同じ「材料の Set に入っていれば済」の形。
 */
describe('テスト対策提案の判定', () => {
  const s1: StudentRow = { id: 's1', grade: 8, teacherId: null, markedNotApplicable: false };
  const s2: StudentRow = { id: 's2', grade: 8, teacherId: null, markedNotApplicable: false };

  it('公開済みの提案がある生徒だけ済になる', () => {
    const p = computeTaskProgress({
      kind: 'test_prep_proposal',
      scope: 'all_students',
      targetGrades: [],
      targetStudentIds: [],
      students: [s1, s2],
      inputs: { testPrepProposedStudentIds: new Set(['s1']) },
    });
    expect(p.unsupported).toBe(false);
    expect(p.done).toBe(1);
    expect(p.notYet).toBe(1);
  });

  it('材料そのものが無ければ全員未済（黙って済にしない）', () => {
    const p = computeTaskProgress({
      kind: 'test_prep_proposal',
      scope: 'all_students',
      targetGrades: [],
      targetStudentIds: [],
      students: [s1],
    });
    expect(p.done).toBe(0);
    expect(p.notYet).toBe(1);
  });
});

/**
 * 講師自身の種別（shift_submit・timesheet_entry）の判定（2026-09-07）。
 *
 * ★生徒に紐づかない（isInScope が teacher_self で false を返すのは変えていない）。
 *   母数は「教室の在籍講師」。渡されなければ材料が無いとして total は0のまま。
 */
describe('講師自身の種別の判定', () => {
  const teachers: TeacherRow[] = [
    { id: 't1', name: '田中' },
    { id: 't2', name: '佐藤' },
    { id: 't3', name: '鈴木' },
  ];

  it('shift_submit / timesheet_entry は判定できる', () => {
    expect(isJudgeable('shift_submit')).toBe(true);
    expect(isJudgeable('timesheet_entry')).toBe(true);
  });

  it('teachers を渡すと講師の人数で母数を数える（students は空のまま）', () => {
    const p = computeTaskProgress({
      kind: 'shift_submit',
      scope: 'teacher_self',
      targetGrades: [],
      targetStudentIds: [],
      students: [],
      teachers,
      inputs: { teacherDoneIds: new Set(['t1']) },
    });
    expect(p.unsupported).toBe(false);
    expect(p.total).toBe(3);
    expect(p.done).toBe(1);
    expect(p.notYet).toBe(2);
    expect(p.students).toEqual([]);
    expect(p.teachers).toHaveLength(3);
    expect(p.teachers?.find((t) => t.teacherId === 't1')?.state).toBe('done');
    expect(p.teachers?.find((t) => t.teacherId === 't2')?.state).toBe('not_yet');
  });

  it('teacherDoneIds が無ければ全員未済（材料が無ければ未済に倒す）', () => {
    const p = computeTaskProgress({
      kind: 'timesheet_entry',
      scope: 'teacher_self',
      targetGrades: [],
      targetStudentIds: [],
      students: [],
      teachers,
    });
    expect(p.done).toBe(0);
    expect(p.notYet).toBe(3);
  });

  it('teachers を渡さなければ total は0（教室の講師一覧が引けなければ数えない）', () => {
    const p = computeTaskProgress({
      kind: 'shift_submit',
      scope: 'teacher_self',
      targetGrades: [],
      targetStudentIds: [],
      students: [],
    });
    expect(p.unsupported).toBe(false);
    expect(p.total).toBe(0);
    expect(p.done).toBe(0);
    expect(p.notYet).toBe(0);
  });

  it('isJudgeable が6種で true', () => {
    const judgeable = [
      'report_card_entry',
      'test_result_entry',
      'progress_entry',
      'test_prep_proposal',
      'shift_submit',
      'timesheet_entry',
    ] as const;
    for (const kind of judgeable) {
      const opts = kind === 'test_result_entry' ? { hasTargetPeriod: true } : undefined;
      expect(isJudgeable(kind, opts)).toBe(true);
    }
  });
});
