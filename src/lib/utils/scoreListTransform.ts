/**
 * 成績一覧用のデータ変換ユーティリティ
 * assessments + assessment_scores を生徒グループ × 複数行の構造に変換し、
 * 前回比の差分(diff)を計算する
 */

import type { AssessmentWithScores, Student } from '@/types/database';
import { ASSESSMENT_NAME_LABELS, GRADE_LABELS } from '@/types/database';
import { calcNaishin } from '@/lib/utils/convertedNaishin';
import type { NaishinType } from '@/lib/utils/convertedNaishin';

// ── 型定義 ──

export type ScoreListCategory = 'regular_test' | 'report_card' | 'mock';

export interface ScoreListRow {
  assessmentId: string;
  label: string;          // "2学期", "1学期中間", "会場模試 2026-03" 等
  nameCode: string;
  grade: number;
  examMonth: string | null;
  scores: Record<string, number | null>;
  diffs: Record<string, number | null>;
  fiveSum: number | null;
  nineSum: number | null;
  fiveSumDiff: number | null;
  nineSumDiff: number | null;
  convertedNaishin: number | null;
  convertedNaishinDiff: number | null;
  hensa3: number | null;
  hensa5: number | null;
  hensa3Diff: number | null;
  hensa5Diff: number | null;
}

export interface ScoreListStudent {
  studentId: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  grade: number;
  schoolId: string;
  /** 生徒の通う学校名（例: 〇〇中学校） */
  schoolName: string | null;
  rows: ScoreListRow[];
}

// ── 定数 ──

const FIVE_SUBJECTS = ['english', 'math', 'japanese', 'social', 'science'] as const;
const NINE_SUBJECTS = ['english', 'math', 'japanese', 'social', 'science', 'music', 'art', 'tech_home', 'pe'] as const;

/** name_code のソート順（時系列）*/
const NAME_CODE_ORDER: Record<string, number> = {
  // 3学期制
  term1_mid: 1, term1_final: 2,
  term2_mid: 3, term2_final: 4,
  year_end: 5,
  // 2学期制
  first_mid: 1, first_final: 2,
  second_mid: 3, second_final: 4,
  // 内申
  term1: 1, term2: 2, first: 1, second: 2,
  // 模試
  venue: 1, classroom: 2,
};

// ── ユーティリティ ──

function sumSubjects(scores: Record<string, number | null>, subjects: readonly string[]): number | null {
  const values = subjects.map((s) => scores[s]).filter((v): v is number => v != null);
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
}

function diffOrNull(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return current - previous;
}

/**
 * Assessment を時系列順にソートするキーを生成
 * grade DESC → exam_month ASC → name_code ASC（時系列順）
 */
function sortKeyForAssessment(a: AssessmentWithScores): string {
  const gradePart = String(a.grade).padStart(2, '0');
  const monthPart = a.exam_month ?? '0000-00';
  const codePart = String(NAME_CODE_ORDER[a.name_code] ?? 99).padStart(2, '0');
  return `${gradePart}-${monthPart}-${codePart}`;
}

function buildRowLabel(assessment: AssessmentWithScores, category: ScoreListCategory): string {
  const nameLabel = ASSESSMENT_NAME_LABELS[assessment.name_code] ?? assessment.name_code;
  const gradeLabel = GRADE_LABELS[assessment.grade] ?? `${assessment.grade}`;
  if (category === 'mock' && assessment.exam_month) {
    const d = new Date(assessment.exam_month);
    return `${gradeLabel} ${nameLabel} ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${gradeLabel} ${nameLabel}`;
}

// ── メイン変換関数 ──

export function transformToScoreList(
  students: (Student & { subjects?: unknown[] })[],
  assessmentsByStudent: Map<string, AssessmentWithScores[]>,
  category: ScoreListCategory,
  naishinType: NaishinType = 'tokyo'
): ScoreListStudent[] {
  const result: ScoreListStudent[] = [];

  for (const student of students) {
    const assessments = assessmentsByStudent.get(student.id);
    if (!assessments || assessments.length === 0) continue;

    // 時系列順にソート（古い順 → 新しい順）
    const sorted = [...assessments].sort((a, b) =>
      sortKeyForAssessment(a).localeCompare(sortKeyForAssessment(b))
    );

    const rows: ScoreListRow[] = [];
    let prevScores: Record<string, number | null> | null = null;
    let prevFiveSum: number | null = null;
    let prevNineSum: number | null = null;
    let prevNaishin: number | null = null;
    let prevHensa3: number | null = null;
    let prevHensa5: number | null = null;

    for (const assessment of sorted) {
      const scoreMap: Record<string, number | null> = {};
      for (const s of assessment.scores) {
        scoreMap[s.subject] = s.value;
      }

      const fiveSum = sumSubjects(scoreMap, FIVE_SUBJECTS);
      const nineSum = sumSubjects(scoreMap, NINE_SUBJECTS);

      // 差分計算
      const diffs: Record<string, number | null> = {};
      const subjects = category === 'report_card' ? NINE_SUBJECTS : FIVE_SUBJECTS;
      for (const subj of subjects) {
        diffs[subj] = prevScores ? diffOrNull(scoreMap[subj], prevScores[subj]) : null;
      }

      // 換算内申（内申タブのみ）
      let convertedNaishin: number | null = null;
      let convertedNaishinDiff: number | null = null;
      if (category === 'report_card') {
        const naishinResult = calcNaishin(scoreMap, naishinType);
        convertedNaishin = naishinResult.converted;
        convertedNaishinDiff = diffOrNull(convertedNaishin, prevNaishin);
        prevNaishin = convertedNaishin;
      }

      // 偏差値（模試タブのみ）
      const hensa3 = category === 'mock' ? (scoreMap['hensa_3'] ?? null) : null;
      const hensa5 = category === 'mock' ? (scoreMap['hensa_5'] ?? null) : null;

      rows.push({
        assessmentId: assessment.id,
        label: buildRowLabel(assessment, category),
        nameCode: assessment.name_code,
        grade: assessment.grade,
        examMonth: assessment.exam_month,
        scores: scoreMap,
        diffs,
        fiveSum,
        nineSum,
        fiveSumDiff: diffOrNull(fiveSum, prevFiveSum),
        nineSumDiff: diffOrNull(nineSum, prevNineSum),
        convertedNaishin,
        convertedNaishinDiff,
        hensa3,
        hensa5,
        hensa3Diff: category === 'mock' ? diffOrNull(hensa3, prevHensa3) : null,
        hensa5Diff: category === 'mock' ? diffOrNull(hensa5, prevHensa5) : null,
      });

      prevScores = scoreMap;
      prevFiveSum = fiveSum;
      prevNineSum = nineSum;
      prevHensa3 = hensa3;
      prevHensa5 = hensa5;
    }

    result.push({
      studentId: student.id,
      lastName: student.last_name,
      firstName: student.first_name,
      lastNameKana: student.last_name_kana,
      firstNameKana: student.first_name_kana,
      grade: student.grade,
      schoolId: student.school_id,
      schoolName: student.school_name ?? null,
      rows,
    });
  }

  // ソート: 学年 ASC → かな順
  result.sort((a, b) => {
    if (a.grade !== b.grade) return a.grade - b.grade;
    const kanaA = `${a.lastNameKana}${a.firstNameKana}`;
    const kanaB = `${b.lastNameKana}${b.firstNameKana}`;
    return kanaA.localeCompare(kanaB, 'ja');
  });

  return result;
}

/**
 * 学年の表示ラベルを取得
 */
export function getGradeLabel(grade: number): string {
  return GRADE_LABELS[grade] ?? `学年${grade}`;
}
