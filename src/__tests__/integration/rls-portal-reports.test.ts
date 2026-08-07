/**
 * 統合テスト: 保護者ポータル 授業報告書の RLS/ビュー境界（docs/portal-v2-requirements.md §7-4）。
 *
 * 保証:
 *   1. ★ status='approved' の報告書だけ可視（draft/submitted/rejected は不可視）。
 *      ＝「公開＝室長の承認」。このStageで最も壊してはいけない条件。
 *   2. 自分の紐づけ生徒の報告書のみ（他アカウントの生徒は不可視）。
 *   3. 退塾日を過ぎた紐づけ生徒の報告書は不可視（Stage1 と同じ失効挙動）。
 *   4. ★ 他教室は不可視（生徒の所属校 ≠ レポートの school_id は出さない）。
 *   5. ★ 内部列（rejection_reason 等）はビューに存在しない（＝列ごと遮断されている）。
 *   6. ★ class_reports / lesson_report_units 本体は portal から読めない（デフォルト拒否の維持）。
 *   7. portal_report_reads は自分の既読だけ可視。
 *
 * seed/cleanup は service role、境界検証は pg 直結（request.jwt.claims + SET ROLE）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient, createTestSchool, cleanupTestSchool } from './helpers';
import { createTestUser, cleanupTestUser } from './rls-helpers';
import { selectAs, tryCountAs } from './portal-rls-helpers';

let admin: SupabaseClient;
let schoolId: string;
let otherSchoolId: string;
let teacherUserId: string;
let slotId: string;
let subjectId: string;

let studentAId: string; // accountA の紐づけ生徒（在籍中）
let studentBId: string; // 別アカウントの生徒（見えてはいけない）
let studentCId: string; // accountA の紐づけ生徒だが退塾超過（見えてはいけない）

let accountAId: string;
let accountBId: string;

// accountA / studentA の報告書（ステータス違い）
let reportApprovedId: string;
let reportDraftId: string;
let reportSubmittedId: string;
let reportRejectedId: string;
// 他アカウントの生徒 / 退塾超過の生徒 / 他教室（すべて approved なのに見えないこと）
let reportBId: string;
let reportCId: string;
let reportOtherSchoolId: string;

let unitApprovedId: string;
let unitDraftId: string;

const uniq = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  admin = getAdminClient();
  const school = await createTestSchool(admin, { name: 'ポータル報告書教室' });
  schoolId = school.id;
  const otherSchool = await createTestSchool(admin, { name: 'ポータル報告書・別教室' });
  otherSchoolId = otherSchool.id;

  const teacher = await createTestUser(admin, { role: 'teacher', schoolIds: [schoolId] });
  teacherUserId = teacher.userId;
  await admin
    .from('user_profiles')
    .update({ display_name: '報告書テスト講師', is_active: true })
    .eq('id', teacherUserId);

  const { data: slot, error: slotErr } = await admin
    .from('schedule_time_slots')
    .insert({
      school_id: schoolId,
      slot_number: 5,
      start_time: '17:20',
      end_time: '18:50',
      is_active: true,
    })
    .select('id')
    .single();
  if (slotErr || !slot) throw new Error(`時限作成失敗: ${slotErr?.message}`);
  slotId = slot.id as string;

  const { data: subject, error: subjErr } = await admin
    .from('subjects')
    .insert({ name: `教科${uniq()}`, grade_category: 'middle' })
    .select('id')
    .single();
  if (subjErr || !subject) throw new Error(`教科作成失敗: ${subjErr?.message}`);
  subjectId = subject.id as string;

  const mkStudent = async (over: Record<string, unknown> = {}) => {
    const u = uniq();
    const { data, error } = await admin
      .from('students')
      .insert({
        school_id: schoolId,
        student_code: `PREP_${u}`,
        last_name: `姓${u}`,
        first_name: `名${u}`,
        last_name_kana: 'セイ',
        first_name_kana: 'メイ',
        grade: 8,
        status: 'active',
        ...over,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`生徒作成失敗: ${error?.message}`);
    return data.id as string;
  };
  studentAId = await mkStudent();
  studentBId = await mkStudent();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  studentCId = await mkStudent({ withdrawal_date: yesterday });

  const mkAccount = async (name: string) => {
    const { data, error } = await admin
      .from('portal_accounts')
      .insert({ display_name: name, login_id: `login_${uniq()}` })
      .select('id')
      .single();
    if (error || !data) throw new Error(`アカウント作成失敗: ${error?.message}`);
    return data.id as string;
  };
  accountAId = await mkAccount('報告書保護者A');
  accountBId = await mkAccount('報告書保護者B');

  await admin.from('portal_account_students').insert([
    { account_id: accountAId, student_id: studentAId, relation: 'guardian' },
    // accountA は退塾済みのCにも紐づく（紐づけは残るが報告書は見えない、を検証する）。
    { account_id: accountAId, student_id: studentCId, relation: 'guardian' },
    { account_id: accountBId, student_id: studentBId, relation: 'guardian' },
  ]);

  const mkEntry = async (studentId: string, date: string) => {
    const { data, error } = await admin
      .from('schedule_entries')
      .insert({
        school_id: schoolId,
        entry_date: date,
        time_slot_id: slotId,
        teacher_id: teacherUserId,
        student_id: studentId,
        subject_ids: [subjectId],
        status: 'completed',
        kind: 'regular',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`予定作成失敗: ${error?.message}`);
    return data.id as string;
  };

  /** 報告書を1件作る。school_id は既定で生徒の所属校（教室スコープ検証用に上書き可）。 */
  const mkReport = async (
    studentId: string,
    date: string,
    status: string,
    over: Record<string, unknown> = {}
  ) => {
    const entryId = await mkEntry(studentId, date);
    const { data, error } = await admin
      .from('class_reports')
      .insert({
        school_id: schoolId,
        schedule_entry_id: entryId,
        student_id: studentId,
        teacher_id: teacherUserId,
        lesson_date: date,
        short_term_goal: '一次関数の変化の割合を求められるようにする',
        mid_term_goal_snapshot: '1学期範囲の弱点をなくす',
        // ★ 内部列: ビューに出てはいけない列を意図的に埋める。
        mid_action_goal_snapshot: '内部・行動目標（保護者に出してはいけない）',
        rejection_reason: '内部・差し戻し理由（保護者に出してはいけない）',
        review_comment: '講評テキスト',
        homework_completion_pct: 90,
        status,
        ...over,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`報告書作成失敗(${status}): ${error?.message}`);
    return data.id as string;
  };

  reportApprovedId = await mkReport(studentAId, '2026-07-14', 'approved');
  reportDraftId = await mkReport(studentAId, '2026-07-13', 'draft');
  reportSubmittedId = await mkReport(studentAId, '2026-07-12', 'submitted');
  reportRejectedId = await mkReport(studentAId, '2026-07-11', 'rejected');
  reportBId = await mkReport(studentBId, '2026-07-14', 'approved');
  reportCId = await mkReport(studentCId, '2026-07-14', 'approved');
  // ★ 教室スコープ検証: studentA の報告書だが school_id が別教室（生徒の所属校と食い違う）。
  reportOtherSchoolId = await mkReport(studentAId, '2026-07-10', 'approved', {
    school_id: otherSchoolId,
  });

  // 学習内容（教材×単元）。承認済みと下書きの両方に付け、親の可視性が継承されることを見る。
  const { data: tb, error: tbErr } = await admin
    .from('textbooks')
    // is_active はローカルDBに無い環境がある（ビューも参照しないので設定しない）。
    .insert({ name: `教材${uniq()}`, subject: '数学' })
    .select('id')
    .single();
  if (tbErr || !tb) throw new Error(`教材作成失敗: ${tbErr?.message}`);
  const textbookId = tb.id as number;

  const mkStudentTextbook = async (studentId: string) => {
    const { data, error } = await admin
      .from('student_textbooks')
      .insert({ school_id: schoolId, student_id: studentId, textbook_id: textbookId })
      .select('id')
      .single();
    if (error || !data) throw new Error(`所持教材作成失敗: ${error?.message}`);
    return data.id as string;
  };
  const stId = await mkStudentTextbook(studentAId);

  const mkUnit = async (reportId: string) => {
    const { data, error } = await admin
      .from('lesson_report_units')
      .insert({
        report_id: reportId,
        student_textbook_id: stId,
        is_main: true,
        curriculum_item_ids: [],
        page_start: 54,
        page_end: 58,
        display_order: 0,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`学習内容作成失敗: ${error?.message}`);
    return data.id as string;
  };
  unitApprovedId = await mkUnit(reportApprovedId);
  unitDraftId = await mkUnit(reportDraftId);

  // 既読（accountA が承認済み報告書を既読・accountB は別の報告書を既読）。
  await admin.from('portal_report_reads').insert([
    { report_id: reportApprovedId, portal_account_id: accountAId },
    { report_id: reportBId, portal_account_id: accountBId },
  ]);
});

afterAll(async () => {
  if (!admin) return;
  await admin
    .from('portal_report_reads')
    .delete()
    .in('portal_account_id', [accountAId, accountBId]);
  await admin.from('class_reports').delete().in('school_id', [schoolId, otherSchoolId]);
  await admin.from('student_textbooks').delete().eq('school_id', schoolId);
  await admin.from('schedule_entries').delete().eq('school_id', schoolId);
  await admin.from('portal_account_students').delete().in('account_id', [accountAId, accountBId]);
  await admin.from('portal_accounts').delete().in('id', [accountAId, accountBId]);
  await admin.from('students').delete().eq('school_id', schoolId);
  await admin.from('schedule_time_slots').delete().eq('school_id', schoolId);
  await admin.from('subjects').delete().eq('id', subjectId);
  if (teacherUserId) await cleanupTestUser(admin, teacherUserId);
  if (otherSchoolId) await cleanupTestSchool(admin, otherSchoolId);
  await cleanupTestSchool(admin, schoolId);
});

describe('★ portal_class_reports: 承認済みだけが公開される（公開＝室長の承認）', () => {
  it('accountA は承認済みの報告書を読める', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from portal_class_reports where id = $1',
      [reportApprovedId]
    );
    expect(rows.length).toBe(1);
  });

  it('★ 下書き(draft)は読めない', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from portal_class_reports where id = $1',
      [reportDraftId]
    );
    expect(rows.length).toBe(0);
  });

  it('★ 提出中(submitted・承認前)は読めない', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from portal_class_reports where id = $1',
      [reportSubmittedId]
    );
    expect(rows.length).toBe(0);
  });

  it('★ 差し戻し(rejected)は読めない', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from portal_class_reports where id = $1',
      [reportRejectedId]
    );
    expect(rows.length).toBe(0);
  });

  it('accountA に見えるのは承認済み1件だけ（未承認が紛れ込まない）', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from portal_class_reports where student_id = $1',
      [studentAId]
    );
    // studentA には approved/draft/submitted/rejected ＋ 別教室 approved があるが、
    // 見えてよいのは自校の approved 1件だけ。
    expect(rows.map((r) => r.id)).toEqual([reportApprovedId]);
  });
});

describe('portal_class_reports: 紐づけ・在籍・教室のスコープ', () => {
  it('他アカウントの生徒(studentB)の報告書は読めない（承認済みでも）', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from portal_class_reports where id = $1',
      [reportBId]
    );
    expect(rows.length).toBe(0);
  });

  it('★ 退塾日を過ぎた紐づけ生徒(studentC)の報告書は読めない（失効）', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from portal_class_reports where id = $1',
      [reportCId]
    );
    expect(rows.length).toBe(0);
  });

  it('★ 他教室の報告書は読めない（生徒の所属校 ≠ レポートの school_id）', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from portal_class_reports where id = $1',
      [reportOtherSchoolId]
    );
    expect(rows.length).toBe(0);
  });

  it('accountB は studentB の報告書のみ読める', async () => {
    const rows = await selectAs('portal', accountBId, 'select id from portal_class_reports');
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(reportBId);
    expect(ids).not.toContain(reportApprovedId);
  });

  it('anon は portal_class_reports を読めない', async () => {
    const count = await tryCountAs('anon', null, 'select id from portal_class_reports limit 1');
    expect(count === 0 || count === -1).toBe(true);
  });
});

describe('★ 内部運用列はビューに存在しない（列ごと遮断）', () => {
  // ビューに列が無い＝ select しようとすると「column does not exist」でエラー。
  // これが「RLS は行の制御であって列の制御ではない」への対処が効いていることの証明。
  const internalColumns = [
    'rejection_reason',
    'mid_action_goal_snapshot',
    'approved_by',
    'rejected_by',
    'rejected_at',
    'submitted_at',
    'approved_at',
    'status',
    'school_id',
    'schedule_entry_id',
  ];

  for (const col of internalColumns) {
    it(`${col} は portal_class_reports に無い`, async () => {
      await expect(
        selectAs('portal', accountAId, `select ${col} from portal_class_reports limit 1`)
      ).rejects.toThrow();
    });
  }

  it('見せる列は揃っている（今日の目標・今月の目標・講評・宿題）', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select short_term_goal, mid_term_goal_snapshot, review_comment, homework_assignments, homework_completion_pct, subject_names from portal_class_reports where id = $1',
      [reportApprovedId]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].review_comment).toBe('講評テキスト');
    expect(rows[0].homework_completion_pct).toBe(90);
  });
});

describe('★ 本体テーブルは portal から読めない（デフォルト拒否の維持）', () => {
  it('portal は class_reports 本体を読めない（grant なし = 42501）', async () => {
    const count = await tryCountAs('portal', accountAId, 'select id from class_reports limit 1');
    expect(count).toBe(-1);
  });

  it('portal は lesson_report_units 本体を読めない', async () => {
    const count = await tryCountAs(
      'portal',
      accountAId,
      'select id from lesson_report_units limit 1'
    );
    expect(count).toBe(-1);
  });

  it('portal は student_textbooks / textbooks / curriculum_items を読めない（名前はビューで解決するため開けない）', async () => {
    expect(await tryCountAs('portal', accountAId, 'select id from student_textbooks limit 1')).toBe(
      -1
    );
    expect(await tryCountAs('portal', accountAId, 'select id from textbooks limit 1')).toBe(-1);
    expect(await tryCountAs('portal', accountAId, 'select id from curriculum_items limit 1')).toBe(
      -1
    );
  });

  it('portal は portal_report_notifications（配信ログ）を読めない', async () => {
    const count = await tryCountAs(
      'portal',
      accountAId,
      'select report_id from portal_report_notifications limit 1'
    );
    expect(count).toBe(-1);
  });
});

describe('portal_lesson_report_units: 親レポートの可視性を継承する', () => {
  it('承認済みレポートの学習内容は読める（教材名がビューで解決される）', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id, textbook_name from portal_lesson_report_units where id = $1',
      [unitApprovedId]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].textbook_name).toBeTruthy();
  });

  it('★ 下書きレポートの学習内容は読めない（親が見えないので子も見えない）', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from portal_lesson_report_units where id = $1',
      [unitDraftId]
    );
    expect(rows.length).toBe(0);
  });

  it('student_textbook_id / curriculum_item_ids は露出しない（名前だけ出す）', async () => {
    await expect(
      selectAs(
        'portal',
        accountAId,
        'select student_textbook_id from portal_lesson_report_units limit 1'
      )
    ).rejects.toThrow();
  });
});

describe('portal_report_reads: 自分の既読だけ可視', () => {
  it('accountA は自分の既読を読める', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select report_id from portal_report_reads where report_id = $1',
      [reportApprovedId]
    );
    expect(rows.length).toBe(1);
  });

  it('accountA は accountB の既読を読めない', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select report_id from portal_report_reads where report_id = $1',
      [reportBId]
    );
    expect(rows.length).toBe(0);
  });

  it('portal は既読を書き込めない（書き込みは service role のみ）', async () => {
    await expect(
      selectAs(
        'portal',
        accountAId,
        'insert into portal_report_reads (report_id, portal_account_id) values ($1, $2)',
        [reportApprovedId, accountAId]
      )
    ).rejects.toThrow();
  });
});
