/**
 * 講師のAIサポート: タスクの有限カタログと、済/未済の判定。
 *
 * 正典: docs/bulletin-ai-assist.html
 *
 * ★AIは投稿を読んで、ここに並んだ種別から選ぶだけ。種別を自由に作らせない。
 *   自由記述にすると「何を見て済とするか」が種別に紐づかなくなり、仕組みが成立しない。
 *
 * ★済の判定は実データで行う。手動チェックは見ない。
 *   清瀬校の実例では、実データ上は内申が41名入力済だったのに手動チェックは13名しか
 *   付いておらず、教室長は手動チェックを見て督促を4回繰り返していた。
 *   実態は「チェックの付け忘れ」で、督促そのものが不要だった。
 */

/** タスクの種別（13種）。DBの bulletin_tasks.kind に入る値 */
export const TASK_KINDS = [
  'report_card_entry', // 内申入力
  'test_result_entry', // テスト結果転記
  'goal_setting', // 目標設定
  'progress_entry', // 進行表入力
  'shift_submit', // シフト提出
  'shift_check', // シフト確認
  'timesheet_entry', // 出勤簿入力
  'material_handout_check', // 教材配布チェック
  'owned_material_check', // 所持教材確認
  'test_prep_proposal', // テスト対策提案
  'application_check', // 申込状況チェック
  'report_deadline', // 報告書の期限
  'report_title_format', // 報告書タイトル形式
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  report_card_entry: '内申入力',
  test_result_entry: 'テスト結果転記',
  goal_setting: '目標設定',
  progress_entry: '進行表入力',
  shift_submit: 'シフト提出',
  shift_check: 'シフト確認',
  timesheet_entry: '出勤簿入力',
  material_handout_check: '教材配布チェック',
  owned_material_check: '所持教材確認',
  test_prep_proposal: 'テスト対策提案',
  application_check: '申込状況チェック',
  report_deadline: '報告書の期限',
  report_title_format: '報告書タイトル形式',
};

/** 誰に出すか（5種）。DBの bulletin_tasks.scope に入る値 */
export const TASK_SCOPES = [
  'all_students', // 全生徒
  'assigned_students', // 担当生徒
  'grade', // 学年
  'specific_students', // 特定生徒
  'teacher_self', // 講師自身（生徒に紐づかない）
] as const;

export type TaskScope = (typeof TASK_SCOPES)[number];

export const TASK_SCOPE_LABELS: Record<TaskScope, string> = {
  all_students: '全生徒',
  assigned_students: '担当生徒',
  grade: '学年',
  specific_students: '特定生徒',
  teacher_self: '講師自身',
};

/**
 * 「どの回か」を人に選ばせる種別と、その選択肢（assessments.name_code）。
 *
 * ★AIには選ばせない。「テスト結果を入力して」という投稿からは、
 *   1学期中間なのか2学期期末なのかが決まらない。推測して外すと、
 *   入っていない回を見て「全員済」と出す——最も危ない方向に誤る。
 */
export const TASK_PERIOD_CHOICES: Partial<Record<TaskKind, readonly string[]>> = {
  report_card_entry: ['term1', 'term2', 'year_end', 'first', 'second'],
  test_result_entry: [
    'term1_mid',
    'term1_final',
    'term2_mid',
    'term2_final',
    'year_end',
    'first_mid',
    'first_final',
    'second_mid',
    'second_final',
  ],
};

/** その種別は「どの回か」を選ぶ必要があるか */
export function needsTargetPeriod(kind: TaskKind): boolean {
  return TASK_PERIOD_CHOICES[kind] !== undefined;
}

/** 期限の型（3種） */
export const TASK_DUE_TYPES = ['date', 'every', 'none'] as const;
export type TaskDueType = (typeof TASK_DUE_TYPES)[number];

/** 生徒に紐づかない種別。完了履歴の student_id が NULL になる */
const TEACHER_SELF_KINDS: ReadonlySet<TaskKind> = new Set<TaskKind>([
  'shift_submit',
  'shift_check',
  'timesheet_entry',
]);

export function isTeacherSelfKind(kind: TaskKind): boolean {
  return TEACHER_SELF_KINDS.has(kind);
}

/* ============================================================
 * 内申入力の判定
 * ========================================================== */

/**
 * 中学校の9科。通知表はこの9科で1セット。
 * ★換算内申（conv_5 / conv_4 / conv_total）は科目ではないので数えない。
 *   「入力された科目数が9以上か」で判定すると、換算内申が混ざって数が水増しされる。
 */
export const REPORT_CARD_SUBJECTS = [
  'english',
  'math',
  'japanese',
  'social',
  'science',
  'music',
  'art',
  'tech_home',
  'pe',
] as const;

/** 中学生の学年（GRADE_LABELS: 7=中1 / 8=中2 / 9=中3） */
export const MIDDLE_SCHOOL_GRADES = [7, 8, 9] as const;

/**
 * 内申入力の対象になる生徒か。
 *
 * ★高校生は科目体系がまったく違う（hs_ で始まる科目が50種近くあり、履修が生徒ごとに違う）。
 *   9科という基準は中学生専用で、高校生には使えない。小学生には内申が無い。
 *   高校生にも同種の依頼を出すなら、判定方法を別に決めること。
 */
export function isReportCardTarget(grade: number | null | undefined): boolean {
  if (grade == null) return false;
  return (MIDDLE_SCHOOL_GRADES as readonly number[]).includes(grade);
}

/**
 * その生徒の内申が入力済みか。★9科すべてそろって初めて済（2026-09-04 決定）。
 *
 * ★本番で確かめたところ、途中まで入力の生徒は0名で、「1科目でも入力」と結果が
 *   完全に一致した（清瀬校の中学生62名中47名）。入れるときは全部入れているので、
 *   厳しい基準を選んでも誰も未済に落ちない。
 *
 * @param enteredSubjects その生徒の通知表に点数が入っている科目コード
 */
export function isReportCardEntered(enteredSubjects: readonly string[]): boolean {
  const entered = new Set(enteredSubjects);
  return REPORT_CARD_SUBJECTS.every((s) => entered.has(s));
}

/* ============================================================
 * 定期テストの判定
 * ========================================================== */

/**
 * 定期テストの対象になる生徒か。
 *
 * ★小学生には定期テストが無い。全生徒あての依頼で小学生を母数に入れると、
 *   誰も入力しようのない人数がずっと残り続ける。
 *   中学生以上（GRADE_LABELS で 7=中1）だけを数える。
 */
export function isRegularTestTarget(grade: number | null | undefined): boolean {
  if (grade == null) return false;
  return grade >= MIDDLE_SCHOOL_GRADES[0];
}

/**
 * 定期テストは「1科目でも点が入っていれば済」。
 *
 * ★内申の9科のような固定のセットが無い。受ける科目は生徒ごとに違い、
 *   何科目そろえば完了なのかを外から決められない。
 *   厳しい基準を勝手に置くと、5科受けた生徒を永久に未済にしてしまう。
 */
export function isRegularTestEntered(enteredSubjectCount: number): boolean {
  return enteredSubjectCount > 0;
}

/** 未入力の科目を返す（督促の文面で「あと何が足りないか」を出すため） */
export function missingReportCardSubjects(enteredSubjects: readonly string[]): string[] {
  const entered = new Set(enteredSubjects);
  return REPORT_CARD_SUBJECTS.filter((s) => !entered.has(s));
}
