import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PortalAssessment,
  PortalScoreSubmission,
  ScoreMap,
  SubmittableScoreCategory,
} from '@/types/portal-scores';

/**
 * 保護者ポータルの成績（Stage 5・§7-5）のDBアクセス層。
 * 正典: docs/portal-v2-requirements.md §7-5。器:
 * supabase/migrations/20260717000000_portal_v2_scores.sql
 *   （portal_score_submissions / portal_assessments）。
 *
 * ★ 読み取り（listPortalAssessments / listPortalScoreSubmissions）はポータルJWTの
 *   クライアント（RLSが効く）で行う。portal_assessments はビュー述語が、
 *   portal_score_submissions は RLS ポリシー（account_id = portal_uid()）が
 *   それぞれ「自分の紐づけ生徒・自分の申請」だけを返す防壁になっている。
 *   ここで service role を使うと防壁をバイパスしてしまうため使わない
 *   （reports.ts の同種コメントと同じ理由）。
 *
 * ★ 書き込み（submitPortalScore）は service role で行う。portal ロールに
 *   INSERT/UPDATE 権限を一切足さない設計（§6-3の不変条件・§7-5柱3）のため、
 *   書き込みは API の入口で requirePortalStudent を通した後の service role 経由のみ。
 */

interface AssessmentRow {
  id: string;
  student_id: string;
  category: string;
  grade: number;
  name_code: string;
  exam_month: string | null;
  exam_date: string | null;
  scores: unknown;
}

interface SubmissionRow {
  id: string;
  student_id: string;
  account_id: string;
  category: string;
  grade: number;
  name_code: string;
  exam_month: string | null;
  scores: unknown;
  status: string;
  rejected_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  assessment_id: string | null;
  created_at: string;
  updated_at: string;
}

/** jsonb の scores 列を防御的に ScoreMap へ正規化する（DBは器・表示前に検証する方針）。 */
function normalizeScores(raw: unknown): ScoreMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: ScoreMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function toPortalAssessment(row: AssessmentRow): PortalAssessment {
  return {
    id: row.id,
    studentId: row.student_id,
    category: row.category as PortalAssessment['category'],
    grade: row.grade,
    nameCode: row.name_code,
    examMonth: row.exam_month,
    examDate: row.exam_date,
    scores: normalizeScores(row.scores),
  };
}

function toPortalScoreSubmission(row: SubmissionRow): PortalScoreSubmission {
  return {
    id: row.id,
    studentId: row.student_id,
    accountId: row.account_id,
    category: row.category as SubmittableScoreCategory,
    grade: row.grade,
    nameCode: row.name_code,
    examMonth: row.exam_month,
    scores: normalizeScores(row.scores),
    status: row.status as PortalScoreSubmission['status'],
    rejectedReason: row.rejected_reason,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    assessmentId: row.assessment_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 承認済み成績の一覧（模試を含む全カテゴリ・§7-5の設計判断）。 */
export async function listPortalAssessments(
  client: SupabaseClient,
  studentId: string
): Promise<PortalAssessment[]> {
  const { data, error } = await client
    .from('portal_assessments')
    .select('id, student_id, category, grade, name_code, exam_month, exam_date, scores')
    .eq('student_id', studentId)
    .order('grade', { ascending: false })
    .order('exam_month', { ascending: false, nullsFirst: false });
  if (error) {
    console.error('[mypage/scores] portal_assessments の取得に失敗:', error.message);
    return [];
  }
  return ((data ?? []) as AssessmentRow[]).map(toPortalAssessment);
}

/** 自分の成績申請の一覧（承認待ち/承認済み/差し戻し。新しい順）。 */
export async function listPortalScoreSubmissions(
  client: SupabaseClient,
  studentId: string
): Promise<PortalScoreSubmission[]> {
  const { data, error } = await client
    .from('portal_score_submissions')
    .select(
      'id, student_id, account_id, category, grade, name_code, exam_month, scores, status, rejected_reason, reviewed_by, reviewed_at, assessment_id, created_at, updated_at'
    )
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[mypage/scores] portal_score_submissions の取得に失敗:', error.message);
    return [];
  }
  return ((data ?? []) as SubmissionRow[]).map(toPortalScoreSubmission);
}

/**
 * 生徒の現在の所属校IDを service role で引く。
 *
 * ★ クライアントの申告を信じない理由: POST body に school_id を持たせて信用すると、
 *   保護者が別教室の school_id を送るだけで承認キューを越境させられる（他教室の
 *   スタッフに見えてしまう/自教室のスタッフから見えなくなる）。申請時点の実際の
 *   所属校を必ずサーバー側で引き直して焼き込む（student_textbooks.school_id と同じ
 *   「所属校と一致」原則・マイグレーションのコメント参照）。
 */
export async function getStudentSchoolId(
  svc: SupabaseClient,
  studentId: string
): Promise<string | null> {
  const { data, error } = await svc
    .from('students')
    .select('school_id')
    .eq('id', studentId)
    .maybeSingle();
  if (error || !data) {
    console.error('[mypage/scores] 生徒の所属校取得に失敗:', error?.message);
    return null;
  }
  return (data as { school_id: string }).school_id;
}

export interface SubmitPortalScoreInput {
  accountId: string;
  studentId: string;
  schoolId: string;
  category: SubmittableScoreCategory;
  grade: number;
  nameCode: string;
  /** normalizeExamMonth 済みの値（'YYYY-MM-DD' または null）。 */
  examMonth: string | null;
  /** validateScores 済みの値。 */
  scores: ScoreMap;
}

/**
 * 同一枠（student_id, category, grade, name_code, exam_month）の status='submitted' 行を1件探す。
 *
 * ★ query の型を any にしている理由: supabase-js のクエリビルダーは呼び出すメソッドの順序に
 *   応じて型が変わる（.eq() を重ねるたびに型引数が変化する）ため、「.eq/.is を好きな回数
 *   チェーンしてから最後に .maybeSingle() する」ヘルパーを汎用的に型付けしようとすると
 *   ESLint 禁止の `Function` 型に頼らざるを得なくなる。ランタイムの形は既存の
 *   admin/portal-chat/threads.ts 等と同じ通常のクエリなので、ここだけ any に落として
 *   可読性を優先する。
 */
async function findSubmittedSlot(
  svc: SupabaseClient,
  slot: Pick<SubmitPortalScoreInput, 'studentId' | 'category' | 'grade' | 'nameCode' | 'examMonth'>,
  extraFilter?: (query: any) => any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<{ id: string } | null> {
  let query: any = svc // eslint-disable-line @typescript-eslint/no-explicit-any
    .from('portal_score_submissions')
    .select('id')
    .eq('status', 'submitted')
    .eq('student_id', slot.studentId)
    .eq('category', slot.category)
    .eq('grade', slot.grade)
    .eq('name_code', slot.nameCode);
  query =
    slot.examMonth === null ? query.is('exam_month', null) : query.eq('exam_month', slot.examMonth);
  if (extraFilter) query = extraFilter(query);

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error('[mypage/scores] 既存申請の検索に失敗:', (error as { message?: string }).message);
    return null;
  }
  return (data as { id: string } | null) ?? null;
}

/**
 * 成績申請を送信する（再送＝置き換え。§7-5）。
 *
 * 同一枠（student_id, category, grade, name_code, exam_month）で自分の status='submitted'
 * が既にあれば UPDATE（scores/updated_at）、無ければ INSERT する。
 *
 * ★ 部分ユニーク索引 idx_portal_score_submissions_pending_slot（status='submitted' に限定・
 *   nulls not distinct）が同一枠の重複 submitted 行をDB側で防いでいる。この関数は
 *   「事前SELECT→無ければINSERT」で通常時のレースを避けつつ、事前SELECTと実際のINSERTの
 *   間に他リクエストが割り込んだ場合（同時送信）に発生する 23505（一意制約違反）を
 *   捕まえて UPDATE にフォールバックする（500にしない）。
 */
export async function submitPortalScore(
  svc: SupabaseClient,
  input: SubmitPortalScoreInput
): Promise<PortalScoreSubmission | null> {
  // 1. 自分の既存 submitted 行を探す（あれば置き換え対象）。
  const existing = await findSubmittedSlot(svc, input, (q) => q.eq('account_id', input.accountId));
  if (existing) {
    return updateSubmissionScores(svc, existing.id, input.scores);
  }

  // 2. 無ければ新規作成。
  const { data: inserted, error: insertError } = await svc
    .from('portal_score_submissions')
    .insert({
      school_id: input.schoolId,
      student_id: input.studentId,
      account_id: input.accountId,
      category: input.category,
      grade: input.grade,
      name_code: input.nameCode,
      exam_month: input.examMonth,
      scores: input.scores,
      status: 'submitted',
    })
    .select(
      'id, student_id, account_id, category, grade, name_code, exam_month, scores, status, rejected_reason, reviewed_by, reviewed_at, assessment_id, created_at, updated_at'
    )
    .single();

  if (!insertError) {
    return toPortalScoreSubmission(inserted as SubmissionRow);
  }

  // 23505 = unique_violation。事前SELECTと今回のINSERTの間に他リクエストが同じ枠へ
  // submitted 行を作った（同時送信のレース）。作られた行を UPDATE で置き換える。
  if ((insertError as { code?: string }).code === '23505') {
    // レースの相手は自分自身（同じアカウントの二重送信）とは限らないため、account_id では
    // 絞らずに枠だけで再検索する（マイグレーションのユニーク索引も account_id を含まない）。
    const retry = await findSubmittedSlot(svc, input);
    if (!retry) {
      console.error('[mypage/scores] 23505フォールバックの再検索で行が見つかりませんでした');
      return null;
    }
    return updateSubmissionScores(svc, retry.id, input.scores);
  }

  console.error('[mypage/scores] 申請の作成に失敗:', insertError.message);
  return null;
}

async function updateSubmissionScores(
  svc: SupabaseClient,
  id: string,
  scores: ScoreMap
): Promise<PortalScoreSubmission | null> {
  const { data, error } = await svc
    .from('portal_score_submissions')
    .update({ scores, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(
      'id, student_id, account_id, category, grade, name_code, exam_month, scores, status, rejected_reason, reviewed_by, reviewed_at, assessment_id, created_at, updated_at'
    )
    .single();
  if (error) {
    console.error('[mypage/scores] 申請の更新に失敗:', error.message);
    return null;
  }
  return toPortalScoreSubmission(data as SubmissionRow);
}
