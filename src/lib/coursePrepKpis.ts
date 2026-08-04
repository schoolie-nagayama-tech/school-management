import type {
  CourseProgressItem,
  StudentCourseProgress,
  CoursePrepPeriod,
  Student,
} from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import type { AutoValues } from '@/lib/api/courseProgress';

/**
 * 講習進捗ダッシュボードのKPI算出ロジックを純関数として切り出したモジュール。
 *
 * 目的: 単一校ダッシュボード（CourseProgressDashboard）と、複数校横断サマリー
 * （AllSchoolsOverview）で「提案コマ・取得コマ・取得率・申込件数・期日超過」の
 * 数え方を1か所に集約し、教室をまたいでも定義がブレないようにする。
 *
 * 注意: 進捗項目（列）は教室ごとに別管理のため、どの項目を「提案増コマ列／決定増コマ列」
 * とみなすかの判定（findItemByKeywords ベース）も校ごとに行う必要がある。
 */

// 項目名キーワードで柔軟に該当列を探す。完全一致を優先し、無ければ部分一致。
export function findItemByKeywords(
  items: CourseProgressItem[],
  keywords: string[]
): CourseProgressItem | undefined {
  for (const kw of keywords) {
    const exact = items.find((i) => i.name === kw);
    if (exact) return exact;
  }
  for (const kw of keywords) {
    const partial = items.find((i) => i.name.includes(kw));
    if (partial) return partial;
  }
  return undefined;
}

/** 提案（提示）増コマ列を特定する。proposed_extra 自動列を最優先で採用。 */
export function findProposedKomaItem(items: CourseProgressItem[]): CourseProgressItem | undefined {
  return (
    items.find((i) => i.auto_source === 'proposed_extra') ??
    findItemByKeywords(items, ['提案増コマ', '提示増コマ', '提案増コマ回数', '提示増コマ回数'])
  );
}

/**
 * 決定（取得）増コマ列を特定する。applied_extra 自動列を最優先で採用。
 * 提案増コマ列と同一列を選ばないよう、除外対象を渡せる。
 */
export function findDecidedKomaItem(
  items: CourseProgressItem[],
  excludeItemId?: string
): CourseProgressItem | undefined {
  return (
    items.find((i) => i.id !== excludeItemId && i.auto_source === 'applied_extra') ??
    items.find(
      (i) =>
        i.id !== excludeItemId &&
        i.column_type === 'number' &&
        (i.name.includes('増コマ回数') || i.name === '増コマ回数決定')
    ) ??
    findItemByKeywords(
      items.filter((i) => i.id !== excludeItemId),
      ['増コマ回数決定', '増コマ決定', '決定コマ']
    )
  );
}

/**
 * 生徒ごとの「決定（取得）増コマ」を算出して返す。
 *
 * 進捗ダッシュボードの studentDecidedKoma と同じ定義:
 * - applied_extra 自動列: max(0, applied_total - course_sessions)
 * - 手入力の「増コマ回数」列: number_value（未入力は0）
 *
 * 請求への同期など、ダッシュボード外からも同じ数え方を使うために切り出している。
 * students は id さえあればよいので軽量なオブジェクト配列でも渡せる。
 */
export function computeDecidedKomaByStudent(
  students: { id: string }[],
  items: CourseProgressItem[],
  progressData: StudentCourseProgress[],
  autoValues: AutoValues
): Record<string, number> {
  const proposedKomaItem = findProposedKomaItem(items);
  const decidedKomaItem = findDecidedKomaItem(items, proposedKomaItem?.id);

  const vals: Record<string, number> = {};
  for (const s of students) {
    if (!decidedKomaItem) {
      vals[s.id] = 0;
      continue;
    }
    if (decidedKomaItem.auto_source === 'applied_extra') {
      const sv = autoValues?.[s.id];
      const appliedTotal = sv?.applied_total ?? 0;
      const courseSessions = sv?.course_sessions ?? 0;
      vals[s.id] = Math.max(0, appliedTotal - courseSessions);
    } else {
      const d = progressData.find((p) => p.student_id === s.id && p.item_id === decidedKomaItem.id);
      vals[s.id] = d?.number_value ?? 0;
    }
  }
  return vals;
}

/**
 * 「進路調査回収」は中3(grade=9)のみが対象の項目。
 * 非中3で明示的な入力が無いセルは「対象外」とみなす（表では自動でグレー表示になる）。
 *
 * この判定は 進捗表・KPI集計（期日超過）・アラート の3か所で使うため、ここを唯一の定義とする。
 * 片方だけに実装すると「表では対象外なのにアラートには残る」といった食い違いが起きる。
 *
 * hasRecord = その生徒×項目に進捗レコードが存在するか。
 * 明示的にクリックして入力された場合は上書きとみなし、対象外にはしない。
 */
export function isGrade9OnlyCoursePrepItem(item: { name: string; column_type: string }): boolean {
  return item.column_type === 'check' && item.name.includes('進路調査');
}

export function isCoursePrepOutOfScope(
  item: { name: string; column_type: string },
  grade: number | null | undefined,
  hasRecord: boolean
): boolean {
  return isGrade9OnlyCoursePrepItem(item) && (grade ?? 0) !== 9 && !hasRecord;
}

export interface SchoolKpis {
  studentCount: number;
  // 提案増コマ合計 / 取得（決定）増コマ合計
  totalProposed: number;
  totalDecided: number;
  // 取得率（取得 ÷ 提案）。提案0は0扱い。
  acquisitionRate: number;
  // 提案を作成済みの生徒数（提示増コマ>0）
  proposedStudentCount: number;
  // 申込済みの生徒数（決定コマの記録あり。0コマ確定も含む）
  decidedStudentCount: number;
  // 期日を過ぎても未完了のチェック項目×生徒 の件数
  overdueCount: number;
  // 期間設定の目標・予算コマ（カードでの達成度表示用）
  targetKoma: number;
  budgetKoma: number;
}

/**
 * 1校分のKPIを算出する。CourseProgressDashboard の各 useMemo と同じ数え方に揃えてある。
 * today は 'YYYY-MM-DD'（期日超過判定の基準日）。
 */
export function computeSchoolKpis(
  students: Student[],
  items: CourseProgressItem[],
  progressData: StudentCourseProgress[],
  autoValues: AutoValues,
  period: CoursePrepPeriod | null,
  today: string
): SchoolKpis {
  // --- 提案増コマ列・決定（取得）増コマ列の特定（finder は共通関数に集約） ---
  const proposedKomaItem = findProposedKomaItem(items);
  const decidedKomaItem = findDecidedKomaItem(items, proposedKomaItem?.id);

  // 生徒ごと 提案増コマ
  const proposedByStudent: Record<string, number> = {};
  for (const s of students) {
    if (proposedKomaItem) {
      if (proposedKomaItem.auto_source === 'proposed_extra') {
        const sv = autoValues?.[s.id];
        const proposalTotal = sv?.proposal_total ?? 0;
        const courseSessions = sv?.course_sessions ?? 0;
        proposedByStudent[s.id] = Math.max(0, proposalTotal - courseSessions);
      } else {
        const d = progressData.find(
          (p) => p.student_id === s.id && p.item_id === proposedKomaItem.id
        );
        proposedByStudent[s.id] = d?.number_value ?? 0;
      }
    } else {
      proposedByStudent[s.id] = 0;
    }
  }

  // 生徒ごと 決定（取得）増コマ と「記録があるか（申込済判定）」
  const decidedByStudent: Record<string, number> = {};
  const decidedHasValue: Record<string, boolean> = {};
  for (const s of students) {
    if (!decidedKomaItem) {
      decidedByStudent[s.id] = 0;
      decidedHasValue[s.id] = false;
      continue;
    }
    if (decidedKomaItem.auto_source === 'applied_extra') {
      const sv = autoValues?.[s.id];
      const appliedTotal = sv?.applied_total ?? 0;
      const courseSessions = sv?.course_sessions ?? 0;
      const val = Math.max(0, appliedTotal - courseSessions);
      decidedByStudent[s.id] = val;
      // 自動列は明示的な0入力の概念が無いので「値>0」を記録ありとみなす
      decidedHasValue[s.id] = val > 0;
    } else {
      const d = progressData.find((p) => p.student_id === s.id && p.item_id === decidedKomaItem.id);
      decidedByStudent[s.id] = d?.number_value ?? 0;
      // 手入力列は number_value が記録されていれば（0でも）申込済とみなす
      decidedHasValue[s.id] = d?.number_value != null;
    }
  }

  const totalProposed = Object.values(proposedByStudent).reduce((a, b) => a + b, 0);
  const totalDecided = Object.values(decidedByStudent).reduce((a, b) => a + b, 0);
  const proposedStudentCount = Object.values(proposedByStudent).filter((v) => v > 0).length;
  const decidedStudentCount = Object.values(decidedHasValue).filter(Boolean).length;

  // --- 期日超過（チェック項目で期日を過ぎ未完了の生徒件数）---
  let overdueCount = 0;
  const overdueItems = items.filter(
    (i) => i.column_type === 'check' && i.deadline && i.deadline < today && !i.is_hidden
  );
  for (const item of overdueItems) {
    for (const s of students) {
      const d = progressData.find((p) => p.student_id === s.id && p.item_id === item.id);
      // 非中3の進路調査など「対象外」セルは期日超過に数えない
      if (isCoursePrepOutOfScope(item, s.grade, !!d)) continue;
      if (!d || (d.status !== 'completed' && d.status !== 'not_applicable')) {
        overdueCount++;
      }
    }
  }

  return {
    studentCount: students.length,
    totalProposed,
    totalDecided,
    acquisitionRate: totalProposed > 0 ? totalDecided / totalProposed : 0,
    proposedStudentCount,
    decidedStudentCount,
    overdueCount,
    targetKoma: period?.target_koma || 0,
    budgetKoma: period?.budget_koma || 0,
  };
}

// =============================================
// 単一校ダッシュボード集計（画面ダッシュボードと印刷レポートで共用）
// ---------------------------------------------
// CourseProgressDashboard に散らばっていた集計（提案/取得コマ・取得率・面談件数・
// 学校種別分析・教科別 提案vs取得・期日超過）をこの純関数に集約する。
// 目的: 画面ダッシュボードと A3 レポートで「同じ数字」を保証し、定義のブレを防ぐこと。
// ここを唯一の集計ロジックとし、両者ともこの戻り値を描画するだけにする。
// =============================================

export type SchoolCategory = 'elementary' | 'middle' | 'high' | 'other';

export function getSchoolCategory(grade: number): SchoolCategory {
  if (grade >= 1 && grade <= 6) return 'elementary';
  if (grade >= 7 && grade <= 9) return 'middle';
  if (grade >= 10 && grade <= 12) return 'high';
  return 'other';
}

export const CATEGORY_LABELS: Record<SchoolCategory, string> = {
  elementary: '小学生',
  middle: '中学生',
  high: '高校生',
  other: 'その他',
};

// 教科別分析の表示順。ここに無い教科は末尾に日本語名順で並ぶ。
export const SUBJECT_ORDER = [
  '国語',
  '算数',
  '数学',
  '英語',
  '英検',
  '理科',
  '社会',
  '理社',
  '小論文',
  '作文',
];

export interface GradeBreakdownRow {
  grade: number;
  label: string;
  count: number;
  proposed: number;
  decided: number;
  avgProposed: number;
  avgDecided: number;
  rate: number;
}

export interface CategoryAnalysisRow {
  category: SchoolCategory;
  label: string;
  studentCount: number;
  proposedCount: number;
  decidedCount: number;
  totalProposed: number;
  totalDecided: number;
  acquisitionRate: number;
  avgProposed: number;
  avgDecided: number;
  gradeBreakdown: GradeBreakdownRow[];
}

export interface SubjectRow {
  subject: string;
  proposed: number;
  applied: number;
  rate: number;
}

export interface DashboardAggregates {
  // どの列を提案/決定増コマとして採用したか（画面の警告表示にも使う）
  proposedKomaItem?: CourseProgressItem;
  decidedKomaItem?: CourseProgressItem;
  studentInterviewItem?: CourseProgressItem;
  parentInterviewItem?: CourseProgressItem;
  // 生徒ごとの提案/取得コマと申込済み判定
  studentProposedKoma: Record<string, number>;
  studentDecidedKoma: Record<string, number>;
  studentDecidedHasValue: Record<string, boolean>;
  // メイン指標
  totalProposed: number;
  totalDecided: number;
  actualRate: number; // 取得 ÷ 提案（小数）
  actualRatePct: number;
  proposedStudentCount: number;
  decidedStudentCount: number;
  studentInterviewCount: number;
  parentInterviewCount: number;
  // 期間設定由来の指標
  expectedRate: number; // 0-100
  expectedKoma: number;
  budgetKoma: number;
  targetKoma: number;
  budgetRate: number;
  targetRate: number;
  // 期日超過
  overdueItems: CourseProgressItem[];
  overdueList: { item: CourseProgressItem; student: Student }[];
  // 内訳
  categoryAnalysis: CategoryAnalysisRow[];
  subjectAnalysis: {
    overall: SubjectRow[];
    elementary: SubjectRow[];
    middle: SubjectRow[];
    high: SubjectRow[];
  };
}

// 面談実施チェックの完了人数を数える
function countCompleted(
  students: Student[],
  progressData: StudentCourseProgress[],
  item?: CourseProgressItem
): number {
  if (!item) return 0;
  let count = 0;
  for (const s of students) {
    const d = progressData.find((p) => p.student_id === s.id && p.item_id === item.id);
    if (d?.status === 'completed') count++;
  }
  return count;
}

/**
 * 単一校ダッシュボードの全集計を算出する純関数。
 * CourseProgressDashboard の各 useMemo と完全に同じ数え方に揃えてある。
 * today は 'YYYY-MM-DD'（期日超過判定の基準日）。
 */
export function computeDashboardAggregates(
  students: Student[],
  items: CourseProgressItem[],
  progressData: StudentCourseProgress[],
  autoValues: AutoValues,
  period: CoursePrepPeriod | null,
  today: string
): DashboardAggregates {
  const proposedKomaItem = findProposedKomaItem(items);
  const decidedKomaItem = findDecidedKomaItem(items, proposedKomaItem?.id);
  const studentInterviewItem = findItemByKeywords(items, ['生徒面談実施', '生徒面談']);
  const parentInterviewItem = findItemByKeywords(items, [
    '父母面談実施',
    '保護者面談実施',
    '父母面談',
    '保護者面談',
  ]);

  // --- 生徒ごと 提案増コマ ---
  const studentProposedKoma: Record<string, number> = {};
  for (const s of students) {
    if (proposedKomaItem) {
      if (proposedKomaItem.auto_source === 'proposed_extra') {
        const sv = autoValues?.[s.id];
        const proposalTotal = sv?.proposal_total ?? 0;
        const courseSessions = sv?.course_sessions ?? 0;
        studentProposedKoma[s.id] = Math.max(0, proposalTotal - courseSessions);
      } else {
        const d = progressData.find(
          (p) => p.student_id === s.id && p.item_id === proposedKomaItem.id
        );
        studentProposedKoma[s.id] = d?.number_value ?? 0;
      }
    } else {
      studentProposedKoma[s.id] = 0;
    }
  }

  // --- 生徒ごと 決定（取得）増コマ と 申込済み判定 ---
  const studentDecidedKoma: Record<string, number> = {};
  const studentDecidedHasValue: Record<string, boolean> = {};
  for (const s of students) {
    if (!decidedKomaItem) {
      studentDecidedKoma[s.id] = 0;
      studentDecidedHasValue[s.id] = false;
      continue;
    }
    if (decidedKomaItem.auto_source === 'applied_extra') {
      const sv = autoValues?.[s.id];
      const appliedTotal = sv?.applied_total ?? 0;
      const courseSessions = sv?.course_sessions ?? 0;
      const val = Math.max(0, appliedTotal - courseSessions);
      studentDecidedKoma[s.id] = val;
      studentDecidedHasValue[s.id] = val > 0;
    } else {
      const d = progressData.find((p) => p.student_id === s.id && p.item_id === decidedKomaItem.id);
      studentDecidedKoma[s.id] = d?.number_value ?? 0;
      studentDecidedHasValue[s.id] = d?.number_value != null;
    }
  }

  const totalProposed = Object.values(studentProposedKoma).reduce((a, b) => a + b, 0);
  const totalDecided = Object.values(studentDecidedKoma).reduce((a, b) => a + b, 0);
  const actualRate = totalProposed > 0 ? totalDecided / totalProposed : 0;
  const proposedStudentCount = Object.values(studentProposedKoma).filter((v) => v > 0).length;
  const decidedStudentCount = Object.values(studentDecidedHasValue).filter(Boolean).length;

  const budgetKoma = period?.budget_koma || 0;
  const targetKoma = period?.target_koma || 0;
  const expectedRate = period?.expected_rate || 0;
  const expectedKoma = Math.round(totalProposed * (expectedRate / 100));
  const budgetRate = budgetKoma > 0 ? totalDecided / budgetKoma : 0;
  const targetRate = targetKoma > 0 ? totalDecided / targetKoma : 0;

  // --- 期日超過タスク ---
  const overdueItems = items.filter(
    (i) => i.column_type === 'check' && i.deadline && i.deadline < today && !i.is_hidden
  );
  const overdueList: { item: CourseProgressItem; student: Student }[] = [];
  for (const item of overdueItems) {
    for (const s of students) {
      const d = progressData.find((p) => p.student_id === s.id && p.item_id === item.id);
      // 非中3の進路調査など「対象外」セルは期日超過に数えない
      if (isCoursePrepOutOfScope(item, s.grade, !!d)) continue;
      if (!d || (d.status !== 'completed' && d.status !== 'not_applicable')) {
        overdueList.push({ item, student: s });
      }
    }
  }

  // --- 学校種別分析（小中高 + 学年内訳）---
  const categoryAnalysis: CategoryAnalysisRow[] = (
    ['elementary', 'middle', 'high'] as SchoolCategory[]
  )
    .map((cat) => {
      const catStudents = students.filter((s) => getSchoolCategory(s.grade) === cat);
      if (catStudents.length === 0) return null;
      const catProposed = catStudents.reduce((sum, s) => sum + (studentProposedKoma[s.id] ?? 0), 0);
      const catDecided = catStudents.reduce((sum, s) => sum + (studentDecidedKoma[s.id] ?? 0), 0);
      const catProposedCount = catStudents.filter(
        (s) => (studentProposedKoma[s.id] ?? 0) > 0
      ).length;
      const catDecidedCount = catStudents.filter((s) => studentDecidedHasValue[s.id]).length;

      const gradeBreakdown: GradeBreakdownRow[] = [];
      const gradeSet = Array.from(new Set(catStudents.map((s) => s.grade))).sort((a, b) => a - b);
      for (const grade of gradeSet) {
        const gs = catStudents.filter((s) => s.grade === grade);
        const gProposed = gs.reduce((sum, s) => sum + (studentProposedKoma[s.id] ?? 0), 0);
        const gDecided = gs.reduce((sum, s) => sum + (studentDecidedKoma[s.id] ?? 0), 0);
        gradeBreakdown.push({
          grade,
          label: GRADE_LABELS[grade] || `${grade}`,
          count: gs.length,
          proposed: gProposed,
          decided: gDecided,
          avgProposed: gs.length > 0 ? gProposed / gs.length : 0,
          avgDecided: gs.length > 0 ? gDecided / gs.length : 0,
          rate: gProposed > 0 ? gDecided / gProposed : 0,
        });
      }

      return {
        category: cat,
        label: CATEGORY_LABELS[cat],
        studentCount: catStudents.length,
        proposedCount: catProposedCount,
        decidedCount: catDecidedCount,
        totalProposed: catProposed,
        totalDecided: catDecided,
        acquisitionRate: catProposed > 0 ? catDecided / catProposed : 0,
        avgProposed: catStudents.length > 0 ? catProposed / catStudents.length : 0,
        avgDecided: catStudents.length > 0 ? catDecided / catStudents.length : 0,
        gradeBreakdown,
      };
    })
    .filter((x): x is CategoryAnalysisRow => x !== null);

  // --- 教科別 提案 vs 取得（提案書ベース）---
  type Agg = Record<string, { proposed: number; applied: number }>;
  const overallAgg: Agg = {};
  const byCat: Record<'elementary' | 'middle' | 'high', Agg> = {
    elementary: {},
    middle: {},
    high: {},
  };
  const add = (agg: Agg, subject: string, proposed: number, applied: number) => {
    if (!agg[subject]) agg[subject] = { proposed: 0, applied: 0 };
    agg[subject].proposed += proposed;
    agg[subject].applied += applied;
  };
  for (const s of students) {
    const sv = autoValues?.[s.id];
    if (!sv) continue;
    const cat = getSchoolCategory(s.grade);
    const subjects = Array.from(
      new Set([
        ...Object.keys(sv.subject_proposals ?? {}),
        ...Object.keys(sv.subject_applied ?? {}),
      ])
    );
    for (const subject of subjects) {
      const p = sv.subject_proposals?.[subject] ?? 0;
      const a = sv.subject_applied?.[subject] ?? 0;
      add(overallAgg, subject, p, a);
      if (cat === 'elementary' || cat === 'middle' || cat === 'high')
        add(byCat[cat], subject, p, a);
    }
  }
  const toRows = (agg: Agg): SubjectRow[] =>
    Object.entries(agg)
      .map(([subject, v]) => ({
        subject,
        proposed: v.proposed,
        applied: v.applied,
        rate: v.proposed > 0 ? v.applied / v.proposed : 0,
      }))
      .sort((a, b) => {
        const ia = SUBJECT_ORDER.indexOf(a.subject);
        const ib = SUBJECT_ORDER.indexOf(b.subject);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.subject.localeCompare(b.subject, 'ja');
      });

  return {
    proposedKomaItem,
    decidedKomaItem,
    studentInterviewItem,
    parentInterviewItem,
    studentProposedKoma,
    studentDecidedKoma,
    studentDecidedHasValue,
    totalProposed,
    totalDecided,
    actualRate,
    actualRatePct: Math.round(actualRate * 100),
    proposedStudentCount,
    decidedStudentCount,
    studentInterviewCount: countCompleted(students, progressData, studentInterviewItem),
    parentInterviewCount: countCompleted(students, progressData, parentInterviewItem),
    expectedRate,
    expectedKoma,
    budgetKoma,
    targetKoma,
    budgetRate,
    targetRate,
    overdueItems,
    overdueList,
    categoryAnalysis,
    subjectAnalysis: {
      overall: toRows(overallAgg),
      elementary: toRows(byCat.elementary),
      middle: toRows(byCat.middle),
      high: toRows(byCat.high),
    },
  };
}
