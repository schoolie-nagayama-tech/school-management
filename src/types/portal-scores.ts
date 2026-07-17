/**
 * 保護者ポータル v2 成績（Stage 5）の共有型。
 * 正典: docs/portal-v2-requirements.md §7-5。DB器は
 * supabase/migrations/20260717000000_portal_v2_scores.sql（portal_score_submissions /
 * portal_assessments）。
 *
 * ★ src/types/mypage-report.ts と同じ理由でサーバー専用にしない:
 *   API の戻り値の形をクライアント（UI）とサーバー（API route・lib）の両方で共有したいが、
 *   lib/mypage/* は `import 'server-only'` のためクライアントから import できない。
 *   型だけをここに置くことで両方から安全に import できる。
 *
 * ★ DTO は camelCase・DBの内部運用列（school_id 等）は極力持たせない方針だが、
 *   school_id はスタッフ側の承認キュー表示（教室名の出し分け等）に要るため
 *   AdminScoreSubmissionQueueItem にだけ含める（保護者向け PortalScoreSubmission は含めない）。
 */

/** 保護者が入力できるカテゴリ（模試は§7-5の設計判断で対象外・DBのCHECKでも入らない）。 */
export type SubmittableScoreCategory = 'regular_test' | 'report_card';

/** 閲覧ビュー（portal_assessments）が返しうる全カテゴリ（模試を含む）。 */
export type AssessmentCategory = 'regular_test' | 'report_card' | 'mock';

export type ScoreSubmissionStatus = 'submitted' | 'approved' | 'rejected';

/** 科目コード → 点数（定期テスト0〜100 / 内申1〜5）。 */
export type ScoreMap = Record<string, number>;

/**
 * 保護者からの成績申請（portal_score_submissions の1行・camelCase DTO）。
 * GET/POST /api/mypage/scores の応答、および承認キューの元データとして使う。
 */
export interface PortalScoreSubmission {
  id: string;
  studentId: string;
  /** 誰が入れたか（監査用）。保護者UIでの表示は想定しない。 */
  accountId: string;
  category: SubmittableScoreCategory;
  grade: number;
  nameCode: string;
  /** 'YYYY-MM-DD'（月初日に正規化済み）。内申は null 可。 */
  examMonth: string | null;
  scores: ScoreMap;
  status: ScoreSubmissionStatus;
  /** 差し戻し理由。保護者に表示する（status='rejected' のときのみ非null）。 */
  rejectedReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** 承認で転記した先の assessments.id。未承認なら null。 */
  assessmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 保護者に公開する成績（限定公開ビュー portal_assessments の1行・camelCase DTO）。
 * 模試を含む全カテゴリ（スタッフが入れたものも含む）が対象。
 */
export interface PortalAssessment {
  id: string;
  studentId: string;
  category: AssessmentCategory;
  grade: number;
  nameCode: string;
  /** 'YYYY-MM-DD'（月初日）。null 可。 */
  examMonth: string | null;
  /** 互換列（exam_month と同値運用）。 */
  examDate: string | null;
  scores: ScoreMap;
}

/**
 * スタッフの承認キュー1件（GET /api/admin/score-submissions の要素）。
 * 差分表示のため、同一枠に既存の assessments 行があればその scores も添える。
 */
export interface AdminScoreSubmissionQueueItem {
  id: string;
  schoolId: string;
  studentId: string;
  studentName: string;
  grade: number;
  category: SubmittableScoreCategory;
  nameCode: string;
  examMonth: string | null;
  scores: ScoreMap;
  status: ScoreSubmissionStatus;
  rejectedReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** 同一枠（category/grade/name_code/exam_month）の既存 assessments 行のID。無ければ null。 */
  existingAssessmentId: string | null;
  /** 既存 assessments 行の現在の scores。行自体が無ければ null（空オブジェクトと区別する）。 */
  existingScores: ScoreMap | null;
}
