/**
 * 掲示板タスクの進捗を組み立てる純関数。
 *
 * 正典: docs/bulletin-ai-assist.html
 *
 * ★済の判定は実データで行う。手動チェックは参照しない。
 *   清瀬校では実データ上41名が入力済だったのに手動チェックは13名しか付いておらず、
 *   教室長は手動チェックを見て督促を4回繰り返していた。実態はチェックの付け忘れだった。
 *
 * DBアクセスは API 側。ここは「引いてきた行をどう数えるか」だけを持つ。
 */

import {
  isRegularTestTarget,
  isReportCardEntered,
  isReportCardTarget,
  type TaskKind,
  type TaskScope,
} from './taskCatalog';

/** 判定に必要な生徒1人分 */
export interface StudentRow {
  id: string;
  grade: number | null;
  /** 担当講師。座席表→固定講師→進行表の順に解決した結果。解決できなければ null */
  teacherId: string | null;
  /** 手動で「対象外」が付いている（人の判断なので尊重して母数から外す） */
  markedNotApplicable: boolean;
}

/** 生徒1人の判定結果 */
export type StudentState =
  | 'done' // 実データで済
  | 'not_yet' // まだ
  | 'excluded' // 対象外（母数に入れない）
  | 'unknown'; // この種別はまだ判定を実装していない

export interface StudentProgress {
  studentId: string;
  teacherId: string | null;
  state: StudentState;
}

export interface TaskProgress {
  /** 母数（対象外を除いた人数） */
  total: number;
  done: number;
  notYet: number;
  /** 対象外にした人数。母数には入れない */
  excluded: number;
  /** 判定できない種別なら true。この場合 total は0になる */
  unsupported: boolean;
  students: StudentProgress[];
}

/**
 * ★済の判定を実装済みの種別。
 *   ここに無い種別は「判定できない」として黙って0を返す。
 *   実データで判定できない種別に無理やり数字を出すと、
 *   その数字を見て督促が飛ぶ——いま起きている問題そのものを再生産する。
 */
export const JUDGEABLE_KINDS: ReadonlySet<TaskKind> = new Set<TaskKind>([
  'report_card_entry',
  'test_result_entry',
  'progress_entry',
]);

/**
 * 実データで数えられる種別か。
 *
 * ★定期テストは「どの回か」が決まるまで数えない。本番の name_code は9種あり、
 *   投稿の文からは決まらない。決め打ちで外すと、入っていない回を見て
 *   「全員済」と出す——最も危ない方向に誤る。教室長が選ぶまでは黙る。
 *
 * ここに無い種別を足すときは、実データで済が判定できることを先に確かめること。
 * 判定できない数字を出すと、その数字を見て督促が飛ぶ（いま起きている問題そのもの）。
 */
export function isJudgeable(kind: TaskKind, opts?: { hasTargetPeriod?: boolean }): boolean {
  if (!JUDGEABLE_KINDS.has(kind)) return false;
  if (kind === 'test_result_entry') return opts?.hasTargetPeriod === true;
  return true;
}

/** タスクの対象に含まれる生徒か（scope と学年・名指しで絞る） */
export function isInScope(
  student: StudentRow,
  scope: TaskScope,
  targetGrades: readonly number[],
  targetStudentIds: readonly string[]
): boolean {
  switch (scope) {
    case 'all_students':
      return true;
    case 'grade':
      // 学年の指定が空なら絞らない（AIが学年を取れなかったときに全員が消えないように）
      return targetGrades.length === 0 || targetGrades.includes(student.grade ?? -1);
    case 'specific_students':
      return targetStudentIds.includes(student.id);
    case 'assigned_students':
      // 担当が解決できない生徒は誰にも配れない。母数からは外さず、進捗ボードには出す
      return true;
    case 'teacher_self':
      // 生徒に紐づかない種別。生徒では数えない
      return false;
  }
}

/** 内申が入力済みの科目（生徒ID → 科目コードの配列） */
export type ReportCardSubjectsByStudent = ReadonlyMap<string, readonly string[]>;

/**
 * 済かどうかを決める材料。種別ごとに使うものが違う。
 * ★APIが引いてきた「事実」だけを入れる。ここで推測しない。
 */
export interface JudgeInputs {
  /** 内申が入っている科目（report_card_entry） */
  subjectsByStudent?: ReportCardSubjectsByStudent;
  /** 指定の回のテストに点が入っている生徒（test_result_entry） */
  testEnteredStudentIds?: ReadonlySet<string>;
  /** 依頼が出てから進行表に記録がある生徒（progress_entry） */
  progressRecordedStudentIds?: ReadonlySet<string>;
}

/** その生徒はこの種別の対象か（学年で外れる種別がある） */
function isKindTarget(kind: TaskKind, grade: number | null): boolean {
  switch (kind) {
    // ★内申は中学生だけ。高校生は科目体系がまったく違い（hs_ が50種近く・履修が生徒ごとに違う）、
    //   9科の基準を当てると全員が永久に未済になる。小学生には内申が無い。
    case 'report_card_entry':
      return isReportCardTarget(grade);
    // ★小学生に定期テストは無い。母数に入れると誰も入力しようのない人数が残り続ける
    case 'test_result_entry':
      return isRegularTestTarget(grade);
    default:
      return true;
  }
}

/** 済か。★材料が無ければ未済に倒す（無いものを済と数えない） */
function isDone(kind: TaskKind, studentId: string, inputs: JudgeInputs): boolean {
  switch (kind) {
    case 'report_card_entry':
      return isReportCardEntered(inputs.subjectsByStudent?.get(studentId) ?? []);
    case 'test_result_entry':
      return inputs.testEnteredStudentIds?.has(studentId) === true;
    case 'progress_entry':
      return inputs.progressRecordedStudentIds?.has(studentId) === true;
    default:
      return false;
  }
}

/**
 * タスク1件の進捗を数える。
 *
 * @param students 教室の在籍生徒（研修用・退会は呼び出し側で除いておく）
 * @param hasTargetPeriod 「どの回か」が選ばれているか。定期テストはこれが無いと数えない
 */
export function computeTaskProgress(params: {
  kind: TaskKind;
  scope: TaskScope;
  targetGrades: readonly number[];
  targetStudentIds: readonly string[];
  students: readonly StudentRow[];
  hasTargetPeriod?: boolean;
  /** @deprecated JudgeInputs.subjectsByStudent を使う（呼び出し互換のために残す） */
  subjectsByStudent?: ReportCardSubjectsByStudent;
  inputs?: JudgeInputs;
}): TaskProgress {
  const { kind, scope, targetGrades, targetStudentIds, students } = params;
  const inputs: JudgeInputs = {
    subjectsByStudent: params.inputs?.subjectsByStudent ?? params.subjectsByStudent,
    testEnteredStudentIds: params.inputs?.testEnteredStudentIds,
    progressRecordedStudentIds: params.inputs?.progressRecordedStudentIds,
  };

  if (!isJudgeable(kind, { hasTargetPeriod: params.hasTargetPeriod })) {
    return { total: 0, done: 0, notYet: 0, excluded: 0, unsupported: true, students: [] };
  }

  const rows: StudentProgress[] = [];

  for (const s of students) {
    if (!isInScope(s, scope, targetGrades, targetStudentIds)) continue;
    if (!isKindTarget(kind, s.grade)) continue;

    // ★「対象外」は人が付けた判断。属性から導かれていないので、そのまま尊重して母数から外す
    if (s.markedNotApplicable) {
      rows.push({ studentId: s.id, teacherId: s.teacherId, state: 'excluded' });
      continue;
    }

    const done = isDone(kind, s.id, inputs);
    rows.push({ studentId: s.id, teacherId: s.teacherId, state: done ? 'done' : 'not_yet' });
  }

  const excluded = rows.filter((r) => r.state === 'excluded').length;
  const done = rows.filter((r) => r.state === 'done').length;
  const notYet = rows.filter((r) => r.state === 'not_yet').length;

  return {
    total: done + notYet,
    done,
    notYet,
    excluded,
    unsupported: false,
    students: rows,
  };
}

/** 講師別の内訳1行 */
export interface TeacherBreakdown {
  teacherId: string | null;
  total: number;
  done: number;
  notYet: number;
}

/**
 * 講師別に畳む。
 * ★担当が解決できない生徒（teacherId=null）も1行として出す。
 *   清瀬校は座席表も固定講師も0件で、担当が誰も解決できないことがある。
 *   黙って消すと合計が合わなくなり、進捗ボードの数字が信用されなくなる。
 */
export function breakdownByTeacher(progress: TaskProgress): TeacherBreakdown[] {
  const map = new Map<string, TeacherBreakdown>();

  for (const r of progress.students) {
    if (r.state === 'excluded') continue;
    const key = r.teacherId ?? '';
    const hit = map.get(key) ?? { teacherId: r.teacherId, total: 0, done: 0, notYet: 0 };
    hit.total += 1;
    if (r.state === 'done') hit.done += 1;
    else hit.notYet += 1;
    map.set(key, hit);
  }

  // 未済の多い順。督促するならここから
  return Array.from(map.values()).sort((a, b) => b.notYet - a.notYet || b.total - a.total);
}
