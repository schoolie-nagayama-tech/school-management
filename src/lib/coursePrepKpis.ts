import type {
  CourseProgressItem,
  StudentCourseProgress,
  CoursePrepPeriod,
  Student,
} from '@/types/database';
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
