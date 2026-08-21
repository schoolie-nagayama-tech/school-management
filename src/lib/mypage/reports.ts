import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPortalServiceClient } from './serviceClient';
import type {
  PortalHomeworkAssignment,
  PortalNextPlanItem,
  PortalReportDetail,
  PortalReportListItem,
  PortalReportUnit,
  PortalSubjectSpecific,
} from '@/types/mypage-report';

/**
 * 保護者ポータルの授業報告書（Stage 4・読み取り面）。
 *
 * 正典: docs/portal-v2-requirements.md §7-4「保護者面（読み取り）」。
 *
 * ★ ポータルJWTのクライアントで限定公開ビューを読む（service role では読まない）:
 *   portal_class_reports / portal_lesson_report_units のビュー述語が
 *   「status='approved'・自分の紐づけ生徒・在籍中・教室スコープ」を担保している。
 *   ここで service role を使うと RLS/ビューをバイパスして読めてしまい（service role は
 *   ビューも所有者権限で素通し）、その防壁を自ら無効化することになる。
 *   **承認前の報告書が保護者に出る事故の唯一の入口がここ**なので、必ず portal
 *   クライアントを使うこと。
 *
 * ★ class_reports 本体は portal に grant していない（デフォルト拒否）。
 *   内部運用列（rejection_reason / mid_action_goal_snapshot / approved_by …）は
 *   ビューに存在しないため、ここから参照しようとしてもそもそも列が無い。
 *
 * ★ 英単語テスト（vocab_test_*）を select しない理由（確定仕様）:
 *   テストは確認テストに一本化された。講師フォームは既に確認テストしか入力させず
 *   vocab_test_* には null しか書かないので、引いても永遠に null。
 *   class_reports の列と portal_class_reports ビューには列が残っているが、
 *   列の削除は適用済みマイグレーションの改変になるため行わず、公開面から外すだけにする
 *   （列は死んだまま無害）。ビュー側を触っていないので、この select から外すのが
 *   保護者に出さないことの実効的な担保になる。
 */

/** ビューが返す一覧用の列（select で明示する列と対応）。 */
interface ReportListRow {
  id: string;
  student_id: string;
  lesson_date: string;
  teacher_id: string | null;
  short_term_goal: string | null;
  check_test_score: number | null;
  check_test_total: number | null;
  check_test_passed: boolean | null;
  homework_completion_pct: number | null;
  subject_names: string[] | null;
}

/** ビューが返す詳細用の列。 */
interface ReportDetailRow extends ReportListRow {
  mid_term_goal_snapshot: string | null;
  school_progress: string | null;
  homework_correct_pct: number | null;
  today_correct_pct: number | null;
  review_comment: string | null;
  homework_assignments: unknown;
  subject_specific: unknown;
  /** 本日の様子マーク。ビュー追加前の環境を踏んでも落ちないよう null 許容で受ける。 */
  tardy: boolean | null;
  homework_not_done: boolean | null;
  /** 次回の予定（jsonb）。講師フォームが書く形を信用せず normalizeNextPlan で正規化する。 */
  next_plan: unknown;
}

interface ReportUnitRow {
  id: string;
  report_id: string;
  is_main: boolean;
  textbook_name: string | null;
  unit_titles: string[] | null;
  page_start: number | null;
  page_end: number | null;
  display_order: number;
}

/** 一覧で引く列（内部列はビューに存在しないので、そもそも書けない）。 */
const LIST_COLUMNS =
  'id, student_id, lesson_date, teacher_id, short_term_goal, check_test_score, check_test_total, check_test_passed, homework_completion_pct, subject_names';

const DETAIL_COLUMNS = `${LIST_COLUMNS}, mid_term_goal_snapshot, school_progress, homework_correct_pct, today_correct_pct, review_comment, homework_assignments, subject_specific, tardy, homework_not_done, next_plan`;

/**
 * 講師名を限定公開ビュー経由で解決する（Stage3 の予定APIと同じ作法）。
 * user_profiles 本体は portal に開けないため、必ずこのビューを通す。
 */
async function resolveTeacherNames(
  client: SupabaseClient,
  teacherIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = Array.from(new Set(teacherIds.filter((v): v is string => !!v)));
  if (ids.length === 0) return map;
  const { data } = await client
    .from('portal_teacher_names')
    .select('id, display_name')
    .in('id', ids);
  for (const t of (data ?? []) as unknown as Array<{ id: string; display_name: string | null }>) {
    if (t.display_name) map.set(t.id, t.display_name);
  }
  return map;
}

/** 既読集合（portal は RLS で自分の行しか読めない）。 */
async function resolveReadIds(client: SupabaseClient, reportIds: string[]): Promise<Set<string>> {
  if (reportIds.length === 0) return new Set();
  const { data } = await client
    .from('portal_report_reads')
    .select('report_id')
    .in('report_id', reportIds);
  return new Set((data ?? []).map((r: { report_id: string }) => r.report_id));
}

/**
 * 一覧用: その生徒の承認済み報告書を新しい順に返す（既読状態をマージ）。
 *
 * @param client    portal クライアント（RLS/ビュー越し）
 * @param studentId 対象生徒（紐づけ検証は呼び出し側の requirePortalStudent が済ませている前提。
 *                  ただしビュー述語も同じ条件を持つので、ここが破られても他生徒は返らない）
 */
export async function getPortalReports(
  client: SupabaseClient,
  studentId: string
): Promise<PortalReportListItem[]> {
  const { data, error } = await client
    .from('portal_class_reports')
    .select(LIST_COLUMNS)
    .eq('student_id', studentId)
    .order('lesson_date', { ascending: false });

  if (error) {
    console.error('[mypage/reports] 一覧の取得に失敗:', error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as ReportListRow[];
  if (rows.length === 0) return [];

  const [teacherMap, readSet] = await Promise.all([
    resolveTeacherNames(
      client,
      rows.map((r) => r.teacher_id).filter((v): v is string => !!v)
    ),
    resolveReadIds(
      client,
      rows.map((r) => r.id)
    ),
  ]);

  return rows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    lessonDate: r.lesson_date,
    subjectNames: r.subject_names ?? [],
    teacherName: r.teacher_id ? (teacherMap.get(r.teacher_id) ?? null) : null,
    shortTermGoal: r.short_term_goal,
    checkTestScore: r.check_test_score,
    checkTestTotal: r.check_test_total,
    checkTestPassed: r.check_test_passed,
    homeworkCompletionPct: r.homework_completion_pct,
    isRead: readSet.has(r.id),
  }));
}

/**
 * 詳細用: 報告書1件。見えなければ null（＝承認前・他人の生徒・退塾超過・他教室）。
 *
 * ★ 「見えない」と「存在しない」を区別しない: ビューが弾いた時点で null を返し、
 *   呼び出し側は 404 にする。存在有無を漏らさないため（承認前の報告書の存在を
 *   403 と 404 の差で推測されない）。
 */
export async function getPortalReport(
  client: SupabaseClient,
  reportId: string
): Promise<PortalReportDetail | null> {
  const { data, error } = await client
    .from('portal_class_reports')
    .select(DETAIL_COLUMNS)
    .eq('id', reportId)
    .maybeSingle();

  if (error) {
    console.error('[mypage/reports] 詳細の取得に失敗:', error.message);
    return null;
  }
  if (!data) return null;

  const r = data as unknown as ReportDetailRow;

  // 学習内容。親レポートが可視なものだけをビューが返す（条件はビュー側で一元化）。
  const { data: unitRows } = await client
    .from('portal_lesson_report_units')
    .select(
      'id, report_id, is_main, textbook_name, unit_titles, page_start, page_end, display_order'
    )
    .eq('report_id', reportId)
    .order('display_order', { ascending: true });

  const units: PortalReportUnit[] = ((unitRows ?? []) as unknown as ReportUnitRow[])
    // メイン教材を先頭に（モックの並び）。同順位は display_order。
    .sort((a, b) => Number(b.is_main) - Number(a.is_main) || a.display_order - b.display_order)
    .map((u) => ({
      id: u.id,
      isMain: u.is_main,
      textbookName: u.textbook_name,
      unitTitles: u.unit_titles ?? [],
      pageStart: u.page_start,
      pageEnd: u.page_end,
      displayOrder: u.display_order,
    }));

  const [teacherMap, readSet] = await Promise.all([
    resolveTeacherNames(client, r.teacher_id ? [r.teacher_id] : []),
    resolveReadIds(client, [r.id]),
  ]);

  return {
    id: r.id,
    studentId: r.student_id,
    lessonDate: r.lesson_date,
    subjectNames: r.subject_names ?? [],
    teacherName: r.teacher_id ? (teacherMap.get(r.teacher_id) ?? null) : null,
    shortTermGoal: r.short_term_goal,
    midTermGoal: r.mid_term_goal_snapshot,
    units,
    schoolProgress: r.school_progress,
    // 本日の様子マーク。値が無ければ false（＝該当なし）に倒す。
    // 「該当したときだけ出す」表示なので、不明を true 側に倒すと誤って保護者に伝わる。
    tardy: r.tardy === true,
    homeworkNotDone: r.homework_not_done === true,
    nextPlan: normalizeNextPlan(r.next_plan),
    homeworkCompletionPct: r.homework_completion_pct,
    homeworkCorrectPct: r.homework_correct_pct,
    todayCorrectPct: r.today_correct_pct,
    checkTestScore: r.check_test_score,
    checkTestTotal: r.check_test_total,
    checkTestPassed: r.check_test_passed,
    reviewComment: r.review_comment,
    homeworkAssignments: normalizeAssignments(r.homework_assignments),
    subjectSpecific: normalizeSubjectSpecific(r.subject_specific),
    isRead: readSet.has(r.id),
  };
}

/**
 * homework_assignments（JSONB）を表示用に正規化する。
 * 講師の入力UI側の形が将来変わっても保護者面が壊れないよう、想定外の形は捨てる
 * （＝ここは信頼できない入力として扱う）。
 */
function normalizeAssignments(raw: unknown): PortalHomeworkAssignment[] {
  if (!Array.isArray(raw)) return [];
  const out: PortalHomeworkAssignment[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const date = typeof rec.date === 'string' ? rec.date : null;
    const text = typeof rec.text === 'string' ? rec.text : null;
    // 中身が無い行は出さない。
    if (!date && !text) continue;
    out.push({ date, text });
  }
  return out;
}

/**
 * next_plan（JSONB。次回の予定 [{textbookName, unitTitles[]}]）を表示用に正規化する。
 * normalizeAssignments と同じ理由で信頼できない入力として扱う（講師フォームが書く形が
 * 変わっても保護者面を壊さない）。単元名が1つも無い要素は落とす
 * ＝呼び出し側は配列が空かどうかだけを見ればよい。
 */
export function normalizeNextPlan(raw: unknown): PortalNextPlanItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PortalNextPlanItem[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const textbookName =
      typeof rec.textbookName === 'string' && rec.textbookName.trim() !== ''
        ? rec.textbookName
        : null;
    const unitTitles = Array.isArray(rec.unitTitles)
      ? rec.unitTitles.filter((t): t is string => typeof t === 'string' && t.trim() !== '')
      : [];
    if (unitTitles.length === 0) continue;
    out.push({ textbookName, unitTitles });
  }
  return out;
}

/**
 * subject_specific（JSONB。科目別欄: 単語・計算・漢字の反復練習＋プリント等自由記述）を
 * 表示用に正規化する。normalizeAssignments と同じ理由で信頼できない入力として扱う:
 * 講師の入力UI（app/lesson-reports/[scheduleEntryId]/page.tsx の SubjectSpecificField）が
 * 書く形が将来変わっても、想定外の形はここで捨てて保護者面を壊さない。
 *
 * kind は 'vocab' | 'calc' | 'kanji' | 'none' の判別 union（型定義は class-report.ts）。
 * 未知の kind（列挙が増えた・書き込みが壊れた等）は丸ごと信用せず null にする
 * （中途半端な形で出すより、セクションごと出さない方が安全）。
 */
export function normalizeSubjectSpecific(raw: unknown): PortalSubjectSpecific | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;

  const kindRaw = rec.kind;
  const kind =
    kindRaw === 'vocab' || kindRaw === 'calc' || kindRaw === 'kanji' || kindRaw === 'none'
      ? kindRaw
      : null;
  if (!kind) return null;

  const range = typeof rec.range === 'string' && rec.range.trim() !== '' ? rec.range : null;
  const pages = typeof rec.pages === 'string' && rec.pages.trim() !== '' ? rec.pages : null;
  const timesPerDay =
    typeof rec.times_per_day === 'number' && Number.isFinite(rec.times_per_day)
      ? rec.times_per_day
      : null;
  const duration =
    typeof rec.duration === 'string' && rec.duration.trim() !== '' ? rec.duration : null;
  const extraMaterials =
    typeof rec.extra_materials === 'string' && rec.extra_materials.trim() !== ''
      ? rec.extra_materials
      : null;

  // 見せられる中身が何も無ければセクションごと出さない（呼び出し側の空判定を単純にする）。
  if (kind === 'none' && !extraMaterials) return null;
  if (kind !== 'none' && !range && !pages && timesPerDay == null && !duration && !extraMaterials) {
    return null;
  }

  return { kind, range, pages, timesPerDay, duration, extraMaterials };
}

/**
 * 報告書を既読にする（service role・portal_report_reads に upsert）。
 *
 * ★ 可視性は呼び出し側（API）が portal クライアントで確認済みであること。
 *   既読行そのものは表示に紐づく無害なデータだが、service role で書く以上
 *   「見えない報告書の既読を作れる」経路にしないため、API 側で必ず可視性を確かめる。
 */
export async function markPortalReportRead(
  accountId: string,
  reportId: string,
  client?: SupabaseClient
): Promise<void> {
  const svc = client ?? getPortalServiceClient();
  const { error } = await svc
    .from('portal_report_reads')
    .upsert(
      { report_id: reportId, portal_account_id: accountId, read_at: new Date().toISOString() },
      { onConflict: 'report_id,portal_account_id', ignoreDuplicates: true }
    );
  if (error) console.error('[mypage/reports] 既読記録に失敗:', error.message);
}
