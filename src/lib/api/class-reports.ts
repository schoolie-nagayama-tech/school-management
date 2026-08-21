/**
 * 授業報告書 (class_reports) の CRUD API
 *
 * 設計ポイント：
 *  - 1コマ×1生徒=1レコードを UNIQUE(schedule_entry_id) で保証
 *  - 単元×教材セット (lesson_report_units) は子テーブル。upsert で全置換する運用
 *  - 保存時の進行表への転記は別関数 syncReportToProgress() に分離（呼び出し側で明示）
 *  - ワークフロー：draft → submitted → approved/rejected
 */

import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
// Phase A: 報告書は個別のみ対象（現状維持）。'individual' 直値を定数参照に置換。
import { INDIVIDUAL_FORMATION } from '@/types/schedule';
import type {
  ClassReport,
  ClassReportFormData,
  ClassReportStatus,
  HomeworkAssignmentItem,
  LessonReportUnit,
} from '@/types/class-report';

// 新規テーブルは Database 型未追加なので any でクエリ
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** schedule_entry_id から報告書を取得（無ければ null） */
export async function getReportByScheduleEntry(
  scheduleEntryId: string
): Promise<ClassReport | null> {
  const { data, error } = await db
    .from('class_reports')
    .select(
      '*, student:students(id, last_name, first_name, grade), teacher:user_profiles!class_reports_teacher_id_fkey(id, display_name, email), units:lesson_report_units(*, student_textbook:student_textbooks(id, textbook_id, textbook:textbooks(id, name)))'
    )
    .eq('schedule_entry_id', scheduleEntryId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching report by schedule entry:', error);
    throw new Error('授業報告書の取得に失敗しました');
  }
  if (!data) return null;
  // units は display_order でソート
  const report = data as ClassReport;
  if (report.units) {
    report.units = [...report.units].sort((a, b) => a.display_order - b.display_order);
  }
  return report;
}

/** ID から報告書を取得 */
export async function getReportById(id: string): Promise<ClassReport | null> {
  const { data, error } = await db
    .from('class_reports')
    .select(
      '*, student:students(id, last_name, first_name, grade), teacher:user_profiles!class_reports_teacher_id_fkey(id, display_name, email), units:lesson_report_units(*, student_textbook:student_textbooks(id, textbook_id, textbook:textbooks(id, name)))'
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Error fetching report by id:', error);
    throw new Error('授業報告書の取得に失敗しました');
  }
  return (data as ClassReport) ?? null;
}

// ============================================
// 前回の授業（報告書フォーム上部の折りたたみカード）
// ============================================

/** 前回の授業でその教材の何回目をやったか。 */
export interface PreviousLessonUnit {
  title: string;
  /** 1〜3回目（student_progress_lessons.lesson_number） */
  lessonNumber: number;
}

/** 前回の授業の、教材（＝セッション）1つぶん。 */
export interface PreviousLessonTextbook {
  studentTextbookId: string;
  textbookName: string;
  units: PreviousLessonUnit[];
  /**
   * その教材の引継ぎ。
   * ★ 教材ごとに別々の内容が入るので連結しない（連結すると誰が何の話をしているのか
   *   分からなくなる）。表示も教材ごとに出す。
   */
  handover: string | null;
  teacherName: string | null;
}

/** 前回の授業に報告書もあったときだけ上乗せされる情報（無いのが普通）。 */
export interface PreviousLessonReportExtras {
  reportId: string;
  status: ClassReportStatus;
  schoolProgress: string | null;
  reviewComment: string | null;
  homeworkAssignments: HomeworkAssignmentItem[];
  homeworkCompletionPct: number | null;
  homeworkCorrectPct: number | null;
  todayCorrectPct: number | null;
}

/** 前回の授業1回ぶん（日付単位。同じ日の複数教材はここにまとまる）。 */
export interface PreviousLessonSummary {
  /** 'YYYY-MM-DD' */
  lessonDate: string;
  textbooks: PreviousLessonTextbook[];
  /** 遅刻・宿題未実施はコマ単位の情報。どれかのセッションに付いていれば付いた扱い */
  tardy: boolean;
  homeworkNotDone: boolean;
  report: PreviousLessonReportExtras | null;
}

/** 同じ日のセッションを取り切るための上限（1コマで扱う教材が数十本になることはない）。 */
const PREVIOUS_LESSON_SESSION_LIMIT = 30;
/** 単元行の取得上限（教材数 × 単元数。上と同じ理由で十分に大きい値）。 */
const PREVIOUS_LESSON_LESSON_LIMIT = 300;

/**
 * 生徒の「前回の授業」を1回ぶん返す（報告書フォームの折りたたみカード用）。
 *
 * ★ 一次情報は進行表の授業記録（progress_sessions）であって報告書ではない:
 *   本番では報告書（class_reports）はまだ運用されておらず数件しか無い一方、
 *   セッションは日々4桁の件数が積まれている。報告書だけを見ると前回カードは
 *   実質どの生徒でも空になるため、セッションを軸にして、同じ日の報告書が
 *   あるときだけ講評・宿題・達成度を上乗せする。
 *   （正典: docs/lesson-report-session-merge-plan.md フェーズ2 §A）
 *
 * ★ 前回の授業は「日付」単位:
 *   同じコマで複数教材を扱えば、その日のセッションは教材ごとに複数できる。
 *   最大の session_date を前回の授業日として、その日のセッションを全部まとめる。
 *
 * 取得に失敗しても null を返して画面を止めない（記入支援であって、無くても報告書は書ける）。
 *
 * @param studentId  対象生徒
 * @param beforeDate この日付より前を探す（'YYYY-MM-DD'。当日は含めない）
 */
export async function getPreviousLessonForStudent(
  studentId: string,
  beforeDate: string
): Promise<PreviousLessonSummary | null> {
  type SessionRow = {
    id: string;
    student_textbook_id: string;
    session_date: string;
    teacher_name: string | null;
    handover: string | null;
    homework_not_done: boolean | null;
    tardy: boolean | null;
    student_textbook?:
      | { id: string; textbook?: { name: string } | { name: string }[] | null }
      | Array<{ id: string; textbook?: { name: string } | { name: string }[] | null }>
      | null;
  };

  // 1. 生徒のセッションを新しい順に。student_textbooks を !inner で埋め込み、
  //    埋め込み側の student_id で絞る（生徒→教材→セッションの2段引きを1回で済ませる）。
  const { data: sessionData, error: sessionErr } = await db
    .from('progress_sessions')
    .select(
      'id, student_textbook_id, session_date, teacher_name, handover, homework_not_done, tardy, student_textbook:student_textbooks!inner(id, student_id, textbook:textbooks(name))'
    )
    .eq('student_textbook.student_id', studentId)
    .lt('session_date', beforeDate)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(PREVIOUS_LESSON_SESSION_LIMIT);

  if (sessionErr) {
    console.error('Error fetching previous lesson sessions:', sessionErr);
    return null;
  }
  const allSessions = (sessionData ?? []) as SessionRow[];
  if (allSessions.length === 0) return null;

  // 先頭が最大の session_date（＝前回の授業日）。同じ日のセッションだけを採用する。
  const lessonDate = allSessions[0].session_date;
  const sessions = allSessions.filter((s) => s.session_date === lessonDate);
  const sessionIds = sessions.map((s) => s.id);

  // 2. その日にやった単元（session_id で紐づく student_progress_lessons）。
  //    単元名は student_progress → curriculum_items まで埋め込みで解決する。
  const unitsBySession = new Map<string, PreviousLessonUnit[]>();
  const { data: lessonData } = await db
    .from('student_progress_lessons')
    .select(
      'session_id, lesson_number, student_progress:student_progress(curriculum_item_id, curriculum_item:curriculum_items(title))'
    )
    .in('session_id', sessionIds)
    .order('lesson_number', { ascending: true })
    .limit(PREVIOUS_LESSON_LESSON_LIMIT);

  type LessonRow = {
    session_id: string | null;
    lesson_number: number;
    student_progress?:
      | { curriculum_item?: { title: string } | { title: string }[] | null }
      | Array<{ curriculum_item?: { title: string } | { title: string }[] | null }>
      | null;
  };
  for (const l of (lessonData ?? []) as LessonRow[]) {
    if (!l.session_id) continue;
    const prog = Array.isArray(l.student_progress) ? l.student_progress[0] : l.student_progress;
    const item = Array.isArray(prog?.curriculum_item)
      ? prog?.curriculum_item[0]
      : prog?.curriculum_item;
    if (!item?.title) continue;
    const bucket = unitsBySession.get(l.session_id) ?? [];
    bucket.push({ title: item.title, lessonNumber: l.lesson_number });
    unitsBySession.set(l.session_id, bucket);
  }

  const textbooks: PreviousLessonTextbook[] = sessions.map((s) => {
    const stb = Array.isArray(s.student_textbook) ? s.student_textbook[0] : s.student_textbook;
    const textbook = Array.isArray(stb?.textbook) ? stb?.textbook[0] : stb?.textbook;
    return {
      studentTextbookId: s.student_textbook_id,
      textbookName: textbook?.name ?? '教材',
      units: unitsBySession.get(s.id) ?? [],
      handover: s.handover && s.handover.trim() !== '' ? s.handover : null,
      teacherName: s.teacher_name,
    };
  });

  // 3. 同じ日の報告書があれば上乗せ（無いのが普通なので、失敗しても素通り）。
  const report = await getReportExtrasForDate(studentId, lessonDate);

  return {
    lessonDate,
    textbooks,
    tardy: sessions.some((s) => s.tardy === true),
    homeworkNotDone: sessions.some((s) => s.homework_not_done === true),
    report,
  };
}

/**
 * 前回の授業日に書かれた報告書から、セッションには無い情報だけを拾う。
 * status は問わない（承認待ち・差し戻し中でも、講師には前回の内容として見せる）。
 */
async function getReportExtrasForDate(
  studentId: string,
  lessonDate: string
): Promise<PreviousLessonReportExtras | null> {
  const { data, error } = await db
    .from('class_reports')
    .select(
      'id, status, school_progress, review_comment, homework_assignments, homework_completion_pct, homework_correct_pct, today_correct_pct'
    )
    .eq('student_id', studentId)
    .eq('lesson_date', lessonDate)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('Error fetching previous lesson report:', error);
    return null;
  }
  const r = data as {
    id: string;
    status: ClassReportStatus;
    school_progress: string | null;
    review_comment: string | null;
    homework_assignments: HomeworkAssignmentItem[] | null;
    homework_completion_pct: number | null;
    homework_correct_pct: number | null;
    today_correct_pct: number | null;
  };
  return {
    reportId: r.id,
    status: r.status,
    schoolProgress: r.school_progress,
    reviewComment: r.review_comment,
    homeworkAssignments: Array.isArray(r.homework_assignments) ? r.homework_assignments : [],
    homeworkCompletionPct: r.homework_completion_pct,
    homeworkCorrectPct: r.homework_correct_pct,
    todayCorrectPct: r.today_correct_pct,
  };
}

/**
 * 報告書を保存（新規作成 or 既存更新）。
 * status は form で指定された値をそのまま反映する：
 *  - 'draft' : 下書き保存
 *  - 'submitted' : 提出（submitted_at を更新）
 *
 * 単元×教材セットは「全削除 → 全件 insert」の置換方式で運用する。
 * 部分更新は複雑性が増す割にメリットが少ないため、シンプルな全置換で扱う。
 */
export async function upsertClassReport(
  schoolId: string,
  form: ClassReportFormData
): Promise<ClassReport> {
  // 既存報告書があるか確認（schedule_entry_id で一意）
  const existing = await getReportByScheduleEntry(form.schedule_entry_id);

  const reportPayload = {
    school_id: schoolId,
    schedule_entry_id: form.schedule_entry_id,
    student_id: form.student_id,
    teacher_id: form.teacher_id,
    lesson_date: form.lesson_date,

    short_term_goal: form.short_term_goal || null,
    mid_term_goal_snapshot: form.mid_term_goal_snapshot || null,
    mid_action_goal_snapshot: form.mid_action_goal_snapshot || null,
    school_progress: form.school_progress || null,

    // 本日の様子マーク（保護者公開）。進行表の正典は progress_sessions 側で、ここはその写し。
    tardy: form.tardy,
    homework_not_done: form.homework_not_done,

    homework_completion_pct: form.homework_completion_pct,
    homework_correct_pct: form.homework_correct_pct,
    today_correct_pct: form.today_correct_pct,
    vocab_test_score: form.vocab_test_score,
    vocab_test_total: form.vocab_test_total,
    vocab_test_passed: form.vocab_test_passed,
    check_test_score: form.check_test_score,
    check_test_total: form.check_test_total,
    check_test_passed: form.check_test_passed,

    review_comment: form.review_comment || null,
    homework_assignments: form.homework_assignments,
    subject_specific: form.subject_specific,

    status: form.status,
    // 提出時に submitted_at を自動セット（draft 状態に戻った場合はクリア）
    submitted_at:
      form.status === 'submitted'
        ? existing?.submitted_at || new Date().toISOString()
        : form.status === 'draft'
          ? null
          : (existing?.submitted_at ?? null),
  };

  let reportId: string;
  if (existing) {
    const { data, error } = await db
      .from('class_reports')
      .update(reportPayload)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) {
      console.error('Error updating class report:', error);
      throw new Error('授業報告書の更新に失敗しました');
    }
    reportId = (data as { id: string }).id;
  } else {
    const { data, error } = await db.from('class_reports').insert(reportPayload).select().single();
    if (error) {
      console.error('Error creating class report:', error);
      throw new Error('授業報告書の作成に失敗しました');
    }
    reportId = (data as { id: string }).id;
  }

  // 子テーブルを全置換
  await db.from('lesson_report_units').delete().eq('report_id', reportId);
  if (form.units.length > 0) {
    const unitRows = form.units.map((u, idx) => ({
      report_id: reportId,
      student_textbook_id: u.student_textbook_id,
      is_main: u.is_main,
      curriculum_item_ids: u.curriculum_item_ids,
      page_start: u.page_start,
      page_end: u.page_end,
      display_order: u.display_order ?? idx,
    }));
    const { error: insErr } = await db.from('lesson_report_units').insert(unitRows);
    if (insErr) {
      console.error('Error inserting lesson_report_units:', insErr);
      throw new Error('教材セットの保存に失敗しました');
    }
  }

  // 報告書全体を再取得して返す（リレーション込み）
  const result = await getReportById(reportId);
  if (!result) throw new Error('保存後の取得に失敗しました');
  return result;
}

/** 室長による承認 */
export async function approveClassReport(
  reportId: string,
  approverId: string
): Promise<ClassReport> {
  const { error } = await db
    .from('class_reports')
    .update({
      status: 'approved' as ClassReportStatus,
      approved_at: new Date().toISOString(),
      approved_by: approverId,
      // 過去に差し戻していた履歴は残しつつ、現状は承認済みに
      rejected_at: null,
      rejected_by: null,
      rejection_reason: null,
    })
    .eq('id', reportId);
  if (error) {
    console.error('Error approving class report:', error);
    throw new Error('授業報告書の承認に失敗しました');
  }
  const report = await getReportById(reportId);
  if (!report) throw new Error('承認後の取得に失敗しました');

  // 保護者ポータルv2(Stage4): 承認＝公開の瞬間に保護者へ通知（画面内＋メール）を1回。
  // ブラウザからのみ fire-and-forget で新設サーバールートを叩く（サーバー実行時は window 無し）。
  // 紐づけ保護者が居なければ API 側で no-op、二重送信は API 側で冪等ガード。
  // 失敗しても承認自体は成功扱い（非致命・握りつぶす）。
  if (typeof window !== 'undefined') {
    void fetch('/api/mypage/reports/system/published', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId }),
    }).catch(() => {
      /* 非致命: 承認は既に成立しているので通知失敗は無視する */
    });
  }

  return report;
}

/** 室長による差し戻し */
export async function rejectClassReport(
  reportId: string,
  rejecterId: string,
  reason?: string
): Promise<ClassReport> {
  const { error } = await db
    .from('class_reports')
    .update({
      status: 'rejected' as ClassReportStatus,
      rejected_at: new Date().toISOString(),
      rejected_by: rejecterId,
      rejection_reason: reason || null,
    })
    .eq('id', reportId);
  if (error) {
    console.error('Error rejecting class report:', error);
    throw new Error('授業報告書の差し戻しに失敗しました');
  }
  const report = await getReportById(reportId);
  if (!report) throw new Error('差し戻し後の取得に失敗しました');
  return report;
}

/**
 * 承認待ち（submitted）の報告書一覧を取得。
 * /lesson-reports/pending 画面で使う。
 */
export async function getPendingReports(schoolIds: string[]): Promise<ClassReport[]> {
  if (schoolIds.length === 0) return [];
  // 承認待ちは滞留すると教室横断で1000行を超えうるため全件ページング取得。
  // lesson_date 昇順を保ちつつ id を第2ソートキーにして安定ページング。
  try {
    return await fetchAllPaged<ClassReport>((from, to) =>
      db
        .from('class_reports')
        .select(
          '*, student:students(id, last_name, first_name, grade), teacher:user_profiles!class_reports_teacher_id_fkey(id, display_name, email)'
        )
        .in('school_id', schoolIds)
        .eq('status', 'submitted')
        .order('lesson_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    console.error('Error fetching pending reports:', e);
    throw new Error('承認待ち報告書の取得に失敗しました');
  }
}

/**
 * 生徒の過去報告書一覧。
 * /students/[id] の「授業報告」タブで使う。
 * 公開済み (approved) のみを返す（保護者にも見せる前提の運用）。
 */
export async function getApprovedReportsByStudent(
  studentId: string,
  limit = 50
): Promise<ClassReport[]> {
  const { data, error } = await db
    .from('class_reports')
    .select('*, teacher:user_profiles!class_reports_teacher_id_fkey(id, display_name, email)')
    .eq('student_id', studentId)
    .eq('status', 'approved')
    .order('lesson_date', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('Error fetching approved reports:', error);
    throw new Error('過去報告書の取得に失敗しました');
  }
  return (data || []) as ClassReport[];
}

/**
 * 講師の未提出報告書を集計（督促画面用）。
 * 「授業日が today 以下、status='draft'、提出期限を過ぎている」エントリを返す。
 *
 * 期限ロジック：授業日 + 3日 をデフォルト期限とする（要件次第で調整）。
 * 厳密には status が NULL（=報告書未作成）の schedule_entries も対象にしたいので、
 * このクエリは別途 schedule_entries × class_reports JOIN で実装する想定。
 * MVP として、まずは draft 状態の class_reports だけを督促対象にする。
 */
export async function getOverdueDraftReports(
  schoolIds: string[],
  daysOverdueThreshold = 3
): Promise<ClassReport[]> {
  if (schoolIds.length === 0) return [];
  const limit = new Date();
  limit.setDate(limit.getDate() - daysOverdueThreshold);
  const limitStr = limit.toISOString().slice(0, 10);

  // draft も滞留すると教室横断で1000行を超えうるため全件ページング取得（id で安定化）
  try {
    return await fetchAllPaged<ClassReport>((from, to) =>
      db
        .from('class_reports')
        .select(
          '*, student:students(id, last_name, first_name, grade), teacher:user_profiles!class_reports_teacher_id_fkey(id, display_name, email)'
        )
        .in('school_id', schoolIds)
        .eq('status', 'draft')
        .lte('lesson_date', limitStr)
        .order('lesson_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    console.error('Error fetching overdue drafts:', e);
    throw new Error('期限切れ報告書の取得に失敗しました');
  }
}

/**
 * 督促対象一覧：「報告書が無い or draft」かつ「授業日が daysOverdueThreshold 日以上前」の schedule_entries を返す。
 *
 * 設計：
 *  - LEFT JOIN class_reports して、status=null か 'draft' のものを抽出
 *  - lesson_date は schedule_entries.entry_date を使う
 *  - 集団・キャンセル・振替元（transferred_out）は対象外
 *
 * 戻り値は schedule_entry の情報 + 紐づく report（あれば）。
 */
export interface OverdueReportTarget {
  schedule_entry_id: string;
  entry_date: string;
  student_id: string;
  teacher_id: string;
  student_name: string;
  student_grade: number;
  teacher_name: string;
  slot_number: number | null;
  report_id: string | null;
  report_status: ClassReportStatus | null;
  days_overdue: number;
}

export async function getOverdueReports(
  schoolIds: string[],
  daysOverdueThreshold = 3
): Promise<OverdueReportTarget[]> {
  if (schoolIds.length === 0) return [];
  const limit = new Date();
  limit.setDate(limit.getDate() - daysOverdueThreshold);
  const limitStr = limit.toISOString().slice(0, 10);

  type Row = {
    id: string;
    entry_date: string;
    student_id: string;
    teacher_id: string;
    time_slot?: { slot_number: number }[] | { slot_number: number };
    student?:
      | { last_name: string; first_name: string; grade: number }[]
      | { last_name: string; first_name: string; grade: number };
    teacher?:
      | { display_name: string | null; email: string | null }[]
      | { display_name: string | null; email: string | null };
    report?:
      | { id: string; status: ClassReportStatus }[]
      | { id: string; status: ClassReportStatus }
      | null;
  };

  // schedule_entries × class_reports を LEFT JOIN で取得。schedule_entries は最大級の
  // テーブルで、教室横断・期日以前の全件は1000行を超えうるため全件ページング取得する
  // （切り捨てると督促対象の一部が静かに漏れる）。entry_date 昇順 + id で安定ページング。
  let rows: Row[];
  try {
    rows = await fetchAllPaged<Row>((from, to) =>
      db
        .from('schedule_entries')
        .select(
          'id, entry_date, student_id, teacher_id, time_slot:schedule_time_slots(slot_number), student:students(last_name, first_name, grade), teacher:user_profiles!schedule_entries_teacher_id_fkey(display_name, email), report:class_reports(id, status)'
        )
        .in('school_id', schoolIds)
        .lte('entry_date', limitStr)
        .in('status', ['scheduled', 'completed', 'transferred_in'])
        // 集団は個別の報告書対象外（将来別途簡易版）。報告書は個別のみ対象。
        .eq('formation', INDIVIDUAL_FORMATION)
        .order('entry_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    console.error('Error fetching overdue reports:', e);
    throw new Error('未提出報告書の取得に失敗しました');
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const targets: OverdueReportTarget[] = [];
  for (const r of rows) {
    const rep = Array.isArray(r.report) ? r.report[0] : r.report;
    const reportStatus = rep?.status ?? null;
    // 「報告書なし」または「draft」だけが督促対象。submitted/approved は除外
    if (reportStatus && reportStatus !== 'draft') continue;

    const student = Array.isArray(r.student) ? r.student[0] : r.student;
    const teacher = Array.isArray(r.teacher) ? r.teacher[0] : r.teacher;
    const slot = Array.isArray(r.time_slot) ? r.time_slot[0] : r.time_slot;

    const entryDate = new Date(r.entry_date + 'T12:00:00');
    const entryDay = new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate());
    const daysOverdue = Math.floor((today.getTime() - entryDay.getTime()) / (24 * 60 * 60 * 1000));

    targets.push({
      schedule_entry_id: r.id,
      entry_date: r.entry_date,
      student_id: r.student_id,
      teacher_id: r.teacher_id,
      student_name: student ? `${student.last_name} ${student.first_name}` : '',
      student_grade: student?.grade ?? 0,
      teacher_name: teacher?.display_name || teacher?.email || '',
      slot_number: slot?.slot_number ?? null,
      report_id: rep?.id ?? null,
      report_status: reportStatus,
      days_overdue: daysOverdue,
    });
  }
  return targets;
}

export type { ClassReport, LessonReportUnit };
