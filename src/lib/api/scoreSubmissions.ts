import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ASSESSMENT_NAME_LABELS } from '@/types/database';
import { COMMON_9_SUBJECTS } from '@/lib/scores/subjects';
import type {
  AdminScoreSubmissionQueueItem,
  PortalScoreSubmission,
  ScoreMap,
  ScoreSubmissionStatus,
  SubmittableScoreCategory,
} from '@/types/portal-scores';

/**
 * スタッフ側の成績申請キュー・承認・差し戻し（Stage 5・§7-5）。service role 経由。
 * 正典: docs/portal-v2-requirements.md §7-5「スタッフ」フロー。
 *
 * ★ なぜ service role か:
 *   portal_score_submissions は authenticated に SELECT のみ許可（UPDATE権限は無い）。
 *   転記（assessments/assessment_scores への書き込み）と申請の状態遷移をアトミックに
 *   行うため、承認・差し戻しは必ずこのモジュール（service role）経由の API を通す
 *   （マイグレーションのコメント §GRANT 参照）。認可（canEditScores・教室スコープ）は
 *   呼び出し側の API ルートが担保する。
 */

interface SubmissionRow {
  id: string;
  school_id: string;
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

const SUBMISSION_COLUMNS =
  'id, school_id, student_id, account_id, category, grade, name_code, exam_month, scores, status, rejected_reason, reviewed_by, reviewed_at, assessment_id, created_at, updated_at';

function normalizeScores(raw: unknown): ScoreMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: ScoreMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
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
    status: row.status as ScoreSubmissionStatus,
    rejectedReason: row.rejected_reason,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    assessmentId: row.assessment_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 承認キュー一覧（教室スコープで絞り込み済み）。
 * 差分表示用に、同一枠の既存 assessments 行があればその scores も添える。
 */
export async function listScoreSubmissionsForReview(
  svc: SupabaseClient,
  schoolIds: string[],
  status: ScoreSubmissionStatus
): Promise<AdminScoreSubmissionQueueItem[]> {
  if (schoolIds.length === 0) return [];

  const { data, error } = await svc
    .from('portal_score_submissions')
    .select(`${SUBMISSION_COLUMNS}, students(last_name, first_name)`)
    .in('school_id', schoolIds)
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[admin/score-submissions] 一覧取得に失敗:', error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as (SubmissionRow & {
    students: { last_name: string; first_name: string } | null;
  })[];

  const items: AdminScoreSubmissionQueueItem[] = [];
  for (const row of rows) {
    const existing = await findExistingAssessmentScores(svc, {
      studentId: row.student_id,
      category: row.category,
      grade: row.grade,
      nameCode: row.name_code,
      examMonth: row.exam_month,
    });
    items.push({
      id: row.id,
      schoolId: row.school_id,
      studentId: row.student_id,
      studentName: row.students ? `${row.students.last_name} ${row.students.first_name}` : '—',
      grade: row.grade,
      category: row.category as SubmittableScoreCategory,
      nameCode: row.name_code,
      examMonth: row.exam_month,
      scores: normalizeScores(row.scores),
      status: row.status as ScoreSubmissionStatus,
      rejectedReason: row.rejected_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      existingAssessmentId: existing?.assessmentId ?? null,
      existingScores: existing?.scores ?? null,
    });
  }
  return items;
}

/** 生の行を取得する（school_id を含む。スコープ検証・内部処理用）。 */
async function getSubmissionRow(svc: SupabaseClient, id: string): Promise<SubmissionRow | null> {
  const { data, error } = await svc
    .from('portal_score_submissions')
    .select(SUBMISSION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as SubmissionRow;
}

/** 申請1件を取得する（school_idスコープ検証はAPIルート側で行う）。 */
export async function getScoreSubmissionById(
  svc: SupabaseClient,
  id: string
): Promise<PortalScoreSubmission | null> {
  const row = await getSubmissionRow(svc, id);
  return row ? toPortalScoreSubmission(row) : null;
}

/** 同一枠の既存 assessments 行と、その scores（jsonb形式に畳んだもの）を探す。 */
async function findExistingAssessmentScores(
  svc: SupabaseClient,
  slot: {
    studentId: string;
    category: string;
    grade: number;
    nameCode: string;
    examMonth: string | null;
  }
): Promise<{ assessmentId: string; scores: ScoreMap } | null> {
  let q = svc
    .from('assessments')
    .select('id')
    .eq('student_id', slot.studentId)
    .eq('category', slot.category)
    .eq('grade', slot.grade)
    .eq('name_code', slot.nameCode);
  q = slot.examMonth === null ? q.is('exam_month', null) : q.eq('exam_month', slot.examMonth);
  // assessments には (student_id, category, grade, name_code, exam_month) の一意制約が無いため
  // maybeSingle() は複数行ヒット時にエラーになる。安全側で先頭1件だけを見る。
  const { data: rows, error } = await q.order('id', { ascending: true }).limit(1);
  if (error || !rows || rows.length === 0) return null;
  const assessmentId = (rows[0] as { id: string }).id;

  const { data: scoreRows, error: scoresError } = await svc
    .from('assessment_scores')
    .select('subject, value')
    .eq('assessment_id', assessmentId);
  if (scoresError) return { assessmentId, scores: {} };

  const scores: ScoreMap = {};
  for (const r of (scoreRows ?? []) as { subject: string; value: number | null }[]) {
    if (typeof r.value === 'number') scores[r.subject] = r.value;
  }
  return { assessmentId, scores };
}

export type ApproveResult =
  | { ok: true; submission: PortalScoreSubmission; assessmentId: string }
  | { ok: false; status: 404 | 403 | 409 | 500; error: string };

/**
 * 承認 = 転記（§7-5）。
 *
 * 手順（アトミックなRPCではなく、順序を守ることで「申請だけapprovedになって転記されない」
 * 状態を避ける設計。マイグレーションにトランザクション関数を追加していないため、途中で
 * 失敗したら申請を 'submitted' のまま残し、次の承認操作で再試行できるようにする）:
 *   1. 同一枠の既存 assessments を探す。無ければ作る（+ COMMON_9_SUBJECTS 分を value=null で用意）。
 *   2. 申請に含まれる科目だけ assessment_scores を upsert（空欄・未申請科目は触らない）。
 *   3. 申請を承認済みに更新（status='submitted' を条件に付けて二重承認を防ぐ）。
 *
 * @param schoolIdScope 呼び出し元（スタッフ）の auth.schoolIds。越境承認の防止はAPIルート側と
 *   ここの両方で行う（多層防御）。
 */
export async function approveScoreSubmission(
  svc: SupabaseClient,
  params: { submissionId: string; reviewerId: string; schoolIdScope: string[] }
): Promise<ApproveResult> {
  const row = await getSubmissionRow(svc, params.submissionId);
  if (!row) return { ok: false, status: 404, error: '申請が見つかりません' };
  if (!params.schoolIdScope.includes(row.school_id)) {
    return { ok: false, status: 403, error: '教室スコープ外です' };
  }
  if (row.status !== 'submitted') {
    return { ok: false, status: 409, error: 'この申請は既に処理済みです' };
  }
  const submission = toPortalScoreSubmission(row);

  // 1. assessments を確保（無ければ作る）。
  let assessmentId: string | null =
    (
      await findExistingAssessmentScores(svc, {
        studentId: submission.studentId,
        category: submission.category,
        grade: submission.grade,
        nameCode: submission.nameCode,
        examMonth: submission.examMonth,
      })
    )?.assessmentId ?? null;

  if (!assessmentId) {
    const { data: created, error: createError } = await svc
      .from('assessments')
      .insert({
        school_id: row.school_id,
        student_id: submission.studentId,
        category: submission.category,
        grade: submission.grade,
        name_code: submission.nameCode,
        title: ASSESSMENT_NAME_LABELS[submission.nameCode] ?? submission.nameCode,
        exam_month: submission.examMonth,
        exam_date: submission.examMonth,
      })
      .select('id')
      .single();
    if (createError || !created) {
      console.error('[admin/score-submissions] assessments作成に失敗:', createError?.message);
      return { ok: false, status: 500, error: '成績行の作成に失敗しました（再試行してください）' };
    }
    assessmentId = (created as { id: string }).id;

    // COMMON_9_SUBJECTS 分を value=null で用意（createAssessmentRow と同じ形）。
    // 失敗しても致命ではない（次の upsert が申請科目ぶんは作るため）ので警告に留める。
    const nullRows = COMMON_9_SUBJECTS.map((subject) => ({
      assessment_id: assessmentId,
      subject,
      value: null,
    }));
    const { error: nullRowsError } = await svc.from('assessment_scores').insert(nullRows);
    if (nullRowsError) {
      console.warn(
        '[admin/score-submissions] 空スコア行の作成に失敗（申請科目は次のupsertで作成される）:',
        nullRowsError.message
      );
    }
  }

  // 2. 申請に含まれる科目だけ upsert（空欄・未申請の科目は触らない＝§7-5）。
  const scoreRows = Object.entries(submission.scores).map(([subject, value]) => ({
    assessment_id: assessmentId,
    subject,
    value,
  }));
  const { error: upsertError } = await svc
    .from('assessment_scores')
    .upsert(scoreRows, { onConflict: 'assessment_id,subject' });
  if (upsertError) {
    console.error('[admin/score-submissions] scores upsertに失敗:', upsertError.message);
    // 申請は 'submitted' のまま（更新していない）なので再試行可能。
    return { ok: false, status: 500, error: '転記に失敗しました（申請は再試行可能な状態です）' };
  }

  // 3. 申請を承認済みに更新。status='submitted' を条件に付け、同時承認による二重転記を防ぐ。
  const { data: updated, error: updateError } = await svc
    .from('portal_score_submissions')
    .update({
      status: 'approved',
      reviewed_by: params.reviewerId,
      reviewed_at: new Date().toISOString(),
      assessment_id: assessmentId,
    })
    .eq('id', submission.id)
    .eq('status', 'submitted')
    .select(SUBMISSION_COLUMNS)
    .maybeSingle();
  if (updateError) {
    console.error('[admin/score-submissions] 申請の更新に失敗:', updateError.message);
    return { ok: false, status: 500, error: '申請の更新に失敗しました（転記は完了しています）' };
  }
  if (!updated) {
    // 更新0件 = 直前の status チェックと本更新の間に他リクエストが先に承認した（レース）。
    return { ok: false, status: 409, error: 'この申請は既に処理済みです' };
  }

  return {
    ok: true,
    submission: toPortalScoreSubmission(updated as SubmissionRow),
    assessmentId,
  };
}

export type RejectResult =
  | { ok: true; submission: PortalScoreSubmission }
  | { ok: false; status: 404 | 403 | 409 | 500; error: string };

/** 差し戻し = 理由必須（保護者に表示される）。§7-5。 */
export async function rejectScoreSubmission(
  svc: SupabaseClient,
  params: { submissionId: string; reviewerId: string; reason: string; schoolIdScope: string[] }
): Promise<RejectResult> {
  const row = await getSubmissionRow(svc, params.submissionId);
  if (!row) return { ok: false, status: 404, error: '申請が見つかりません' };
  if (!params.schoolIdScope.includes(row.school_id)) {
    return { ok: false, status: 403, error: '教室スコープ外です' };
  }
  if (row.status !== 'submitted') {
    return { ok: false, status: 409, error: 'この申請は既に処理済みです' };
  }

  const { data: updated, error } = await svc
    .from('portal_score_submissions')
    .update({
      status: 'rejected',
      rejected_reason: params.reason,
      reviewed_by: params.reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('status', 'submitted')
    .select(SUBMISSION_COLUMNS)
    .maybeSingle();
  if (error) {
    console.error('[admin/score-submissions] 差し戻しに失敗:', error.message);
    return { ok: false, status: 500, error: '差し戻しに失敗しました' };
  }
  if (!updated) {
    return { ok: false, status: 409, error: 'この申請は既に処理済みです' };
  }
  return { ok: true, submission: toPortalScoreSubmission(updated as SubmissionRow) };
}
