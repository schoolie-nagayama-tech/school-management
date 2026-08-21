/**
 * 保護者プレビュー: 講師フォームの現在値から保護者面の表示データを組み立てる（純関数）
 *
 * 正典: docs/lesson-report-session-merge-plan.md フェーズ2 §E。
 *
 * ★ 見た目を作り直さない:
 *   プレビューは保護者が実際に見るコンポーネント（components/mypage/ReportDetail）を
 *   そのまま描く。ここがやるのは「フォームの状態 → PortalReportDetail」の変換だけ。
 *   別の見た目を作ると、公開面を直したときに必ずプレビューだけ取り残されてズレる。
 *
 * ★ lib/mypage/reports.ts（本番の変換）を import しない理由:
 *   あちらは `import 'server-only'` でクライアントから読めない。よって正規化規則
 *   （空の項目は出さない・kind='none' は extraMaterials があるときだけ残す 等）を
 *   ここに同じ形で書き写している。**片方だけ直さないこと**。
 *   ただし入力の性格は違う: あちらは DB の jsonb（信用できない unknown）、
 *   こちらは型の付いたフォーム状態なので、型判定ではなく空判定だけを行う。
 */

import type { ClassReportFormData, SubjectSpecific } from '@/types/class-report';
import type {
  PortalHomeworkAssignment,
  PortalNextPlanItem,
  PortalReportDetail,
  PortalReportUnit,
  PortalSubjectSpecific,
} from '@/types/mypage-report';
import { compactHomeworkRows } from './reportSchedule';

/** プレビューの報告書ID（実在しない値。既読APIを叩かせないための目印も兼ねる）。 */
export const PORTAL_PREVIEW_REPORT_ID = 'preview';

/** 教材セット1つぶんの表示材料。教材名・単元名は画面側で解決済みのものを渡す。 */
export interface PortalPreviewUnitInput {
  isMain: boolean;
  /** 教材名（保護者面はIDを見ない） */
  textbookName: string;
  /** 今日やった単元の名前（進行表グリッドの選択順＝カリキュラム順） */
  unitTitles: string[];
  pageStart: number | null;
  pageEnd: number | null;
  displayOrder: number;
}

export interface PortalPreviewInput {
  /** フォームの現在値 */
  form: ClassReportFormData;
  units: PortalPreviewUnitInput[];
  /** 学校の進度（上段のチップと同じ材料から組み立てた文字列） */
  schoolProgress: string;
  /**
   * 次回の予定（教材ごと）。form ではなく別入力で受けるのは units / schoolProgress と同じ理由で、
   * 単元名の解決（ID → 名前）が画面側でしかできないため。保存される next_plan と同じ値を渡すこと。
   */
  nextPlan?: PortalNextPlanItem[];
  teacherName: string | null;
  /** コマの教科名。保護者面のヘッダー側で使う値で、詳細本文には出ない */
  subjectNames?: string[];
  /** 確認テストの合否（得点からの自動判定結果。保存されるのと同じ値） */
  checkTestPassed: boolean | null;
}

/**
 * フォームの現在値 → 保護者面の詳細データ。
 *
 * 保存前の値をそのまま写すので「提出したらこう出る」を先に確認できる。
 * isRead は true 固定（プレビューは既読状態を作らない。ReportDetail 側も
 * preview のときは既読APIを叩かない＝二重の歯止め）。
 */
export function buildPortalPreview(input: PortalPreviewInput): PortalReportDetail {
  const { form, teacherName, checkTestPassed } = input;

  return {
    id: PORTAL_PREVIEW_REPORT_ID,
    studentId: form.student_id,
    lessonDate: form.lesson_date,
    subjectNames: input.subjectNames ?? [],
    teacherName,
    shortTermGoal: emptyToNull(form.short_term_goal),
    // 試験目標は保存時に formatExamGoal で整形した文字列が入る列。
    // まだ組み立てていない（＝スナップショット前の）ときは空として扱う。
    midTermGoal: emptyToNull(form.mid_term_goal_snapshot),
    units: toPortalUnits(input.units),
    schoolProgress: emptyToNull(input.schoolProgress),
    tardy: form.tardy,
    homeworkNotDone: form.homework_not_done,
    // 単元が1つも決まっていない教材は出さない（保護者面で空の見出しを作らない）
    nextPlan: (input.nextPlan ?? []).filter((item) => item.unitTitles.length > 0),
    subjectSpecific: toPortalSubjectSpecific(form.subject_specific),
    homeworkCompletionPct: form.homework_completion_pct,
    homeworkCorrectPct: form.homework_correct_pct,
    todayCorrectPct: form.today_correct_pct,
    checkTestScore: form.check_test_score,
    checkTestTotal: form.check_test_total,
    checkTestPassed,
    reviewComment: emptyToNull(form.review_comment),
    // 保存されるのと同じ行だけ見せる（空欄の日は保存しないので保護者にも出ない）
    homeworkAssignments: toPortalHomework(form.homework_assignments),
    isRead: true,
  };
}

/** 空文字・空白だけの文字列は null（保護者面は「値が無い＝セクションごと出さない」） */
function emptyToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 学習内容。メイン教材を先頭に、同順位は display_order（lib/mypage/reports.ts と同じ並び）。
 * 単元が1つも選ばれていない教材セットも出す（保存すれば行として作られ、保護者にも出るため）。
 */
function toPortalUnits(units: PortalPreviewUnitInput[]): PortalReportUnit[] {
  return units
    .map((u, index) => ({
      id: `${PORTAL_PREVIEW_REPORT_ID}-unit-${index}`,
      isMain: u.isMain,
      textbookName: u.textbookName || null,
      unitTitles: u.unitTitles,
      pageStart: u.pageStart,
      pageEnd: u.pageEnd,
      displayOrder: u.displayOrder,
    }))
    .sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.displayOrder - b.displayOrder);
}

/** 次回までの宿題。保存時と同じ圧縮（空欄の日は落とす）をかけてから保護者面の形にする。 */
function toPortalHomework(
  rows: ClassReportFormData['homework_assignments']
): PortalHomeworkAssignment[] {
  return compactHomeworkRows(rows).map((r) => ({
    date: r.date === '' ? null : r.date,
    text: r.text,
  }));
}

/**
 * 科目別欄（単語・計算・漢字の反復練習）＋プリント等の自由記述。
 * 空判定の規則は lib/mypage/reports.ts の normalizeSubjectSpecific と同じ:
 *   - kind='none' は extraMaterials があるときだけ残す
 *   - kind が付いていても中身が全部空なら丸ごと出さない
 */
export function toPortalSubjectSpecific(
  value: SubjectSpecific | null
): PortalSubjectSpecific | null {
  if (!value) return null;

  const extraMaterials = emptyToNull(value.extra_materials);
  if (value.kind === 'none') {
    return extraMaterials ? { ...emptyPractice('none'), extraMaterials } : null;
  }

  const range = emptyToNull(value.range);
  const pages = emptyToNull(value.pages);
  const timesPerDay = Number.isFinite(value.times_per_day) ? value.times_per_day : null;
  const duration = emptyToNull(value.duration);
  if (!range && !pages && timesPerDay == null && !duration && !extraMaterials) return null;

  return { kind: value.kind, range, pages, timesPerDay, duration, extraMaterials };
}

/** 中身が空の科目別欄（extraMaterials だけを載せて返すための土台）。 */
function emptyPractice(kind: PortalSubjectSpecific['kind']): PortalSubjectSpecific {
  return {
    kind,
    range: null,
    pages: null,
    timesPerDay: null,
    duration: null,
    extraMaterials: null,
  };
}
