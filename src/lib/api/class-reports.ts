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
