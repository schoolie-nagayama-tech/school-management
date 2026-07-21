/**
 * 保護者の成績申請（portal_score_submissions）の値バリデーション（純関数）。
 * 正典: docs/portal-v2-requirements.md §7-5「値のバリデーション（サーバー・service role APIの入口）」。
 *
 * ★ なぜここに集約するか:
 *   DB（マイグレーション）は器に徹し、範囲チェックはAPI入口で行う設計（§7-5・スコア列コメント参照）。
 *   POST /api/mypage/scores から使うが、client/server 両方から参照されうる純関数として
 *   lib/mypage/ 直下に置く（transferDeadline.ts と同じ流儀。server-only は付けない）。
 *
 * ★ COMMON_9_SUBJECTS は src/lib/scores/subjects.ts から import する（assessments.ts と共有）。
 */
import { COMMON_9_SUBJECTS, isCommonSubjectCode } from '@/lib/scores/subjects';
import { ASSESSMENT_NAME_OPTIONS, SUBJECT_LABELS } from '@/types/database';
import type { ScoreMap, SubmittableScoreCategory } from '@/types/portal-scores';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** 保護者が入力できるカテゴリか（模試は§7-5の設計判断で対象外。DBのCHECKでも入らない）。 */
export function isSubmittableCategory(c: unknown): c is SubmittableScoreCategory {
  return c === 'regular_test' || c === 'report_card';
}

/**
 * カテゴリ別の点数の値域。
 * 定期テスト = 整数0〜100（100点満点のテストが前提）。
 * 内申 = 整数1〜5（5段階評価が前提）。
 */
function scoreRange(category: SubmittableScoreCategory): { min: number; max: number } {
  return category === 'regular_test' ? { min: 0, max: 100 } : { min: 1, max: 5 };
}

/**
 * 科目別点数オブジェクトを検証する。
 *
 * - 科目キーは COMMON_9_SUBJECTS のみ許可（未知キーは400相当のエラー）。
 * - 値は整数のみ（NaN・小数・文字列は不可）、カテゴリ別の範囲内であること。
 * - 空オブジェクト（1科目も無い）は拒否する（§7-5「1科目以上必須」）。
 *
 * @param category 'regular_test' | 'report_card'（isSubmittableCategory で絞り込み済みのものを渡す）
 * @param scores   リクエストボディの生値（unknown）
 */
export function validateScores(
  category: SubmittableScoreCategory,
  scores: unknown
): ValidationResult<ScoreMap> {
  if (
    typeof scores !== 'object' ||
    scores === null ||
    Array.isArray(scores) ||
    // jsonb化を見越して Date 等の特殊オブジェクトも弾く（プレーンオブジェクトのみ許可）。
    Object.getPrototypeOf(scores) !== Object.prototype
  ) {
    return { ok: false, error: 'scores はオブジェクトで指定してください' };
  }

  const entries = Object.entries(scores as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, error: '科目を1つ以上入力してください' };
  }

  const { min, max } = scoreRange(category);
  const value: ScoreMap = {};

  for (const [subject, raw] of entries) {
    if (!isCommonSubjectCode(subject)) {
      return { ok: false, error: `未知の科目です: ${subject}` };
    }
    // ★ エラー文言は保護者のモーダルにそのまま表示される（ScoreSubmitModal は
    //   サーバー文言を直出しする設計）。生の科目コード（english 等）を見せないよう
    //   必ず日本語ラベルで組み立てる。
    const subjectLabel = SUBJECT_LABELS[subject] ?? subject;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
      return { ok: false, error: `${subjectLabel}の点数は整数で入力してください` };
    }
    if (raw < min || raw > max) {
      return {
        ok: false,
        error: `${subjectLabel}の点数は${min}〜${max}の範囲で入力してください`,
      };
    }
    value[subject] = raw;
  }

  return { ok: true, value };
}

/** 'YYYY-MM' 形式かどうか（月は01〜12）。 */
function isYyyyMm(input: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(input);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

/**
 * exam_month を 'YYYY-MM' → 'YYYY-MM-01'（月初日）に正規化する
 * （portal_transfer_permissions.month と同じ流儀。§7-5）。
 *
 * - report_card（内申）は月を持たない運用があるため null を許可する。
 * - regular_test（定期テスト）は原本にテスト実施月があるはずなので null は不可。
 * - 'YYYY-MM' 以外の形式（既に 'YYYY-MM-DD' になっている等）は不正としてエラーにする
 *   （表記ゆれをAPI入口で構造的に防ぐ。DB側の同名CHECKと二重の防御）。
 */
export function normalizeExamMonth(
  input: string | null,
  category: SubmittableScoreCategory
): ValidationResult<string | null> {
  if (input === null || input === '') {
    if (category === 'report_card') {
      return { ok: true, value: null };
    }
    return { ok: false, error: '定期テストは年月の入力が必要です' };
  }
  if (typeof input !== 'string' || !isYyyyMm(input)) {
    return { ok: false, error: '年月は YYYY-MM 形式で指定してください' };
  }
  return { ok: true, value: `${input}-01` };
}

/**
 * name_code が ASSESSMENT_NAME_OPTIONS の該当カテゴリの選択肢に含まれるかを検証する。
 * 'legacy'（過去データ移行用の逃がし値）は ASSESSMENT_NAME_OPTIONS に含まれないため、
 * この検証だけで自動的に拒否される。
 */
export function validateNameCode(category: SubmittableScoreCategory, nameCode: unknown): boolean {
  if (typeof nameCode !== 'string') return false;
  const options = ASSESSMENT_NAME_OPTIONS[category] as readonly { code: string }[];
  return options.some((o) => o.code === nameCode);
}

/** grade（学年）が assessments/portal_score_submissions の CHECK と同じ 1〜13 の範囲か。 */
export function isValidGrade(grade: unknown): grade is number {
  return typeof grade === 'number' && Number.isInteger(grade) && grade >= 1 && grade <= 13;
}

// テスト側で「許可される科目一覧」を直接参照できるよう再エクスポートしておく。
export { COMMON_9_SUBJECTS };
