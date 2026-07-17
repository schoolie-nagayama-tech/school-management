/**
 * 統合テスト: 保護者ポータル スケジュールの RLS 境界（docs/portal-v2-requirements.md §4・§7-3）。
 *
 * 保証:
 *   1. portal は自分の紐づけ生徒の schedule_entries だけ可視（他生徒は不可視）。
 *   2. 退塾日を過ぎた紐づけ生徒の予定は不可視（Stage1 と同じ失効挙動）。
 *   3. portal は portal_transfer_permissions / transfer_free_periods /
 *      schedule_regular_patterns を読めない（デフォルト拒否の維持）。
 *      ★ これが §7-3 の「ポータルに素の座席表テーブルを開けない」の実地確認。
 *   4. portal_teacher_names（限定公開ビュー）は読めるが user_profiles 本体は読めない。
 *   5. anon は schedule_entries を読めない。
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
let teacherUserId: string;
let slotId: string;
let subjectId: string;

let studentAId: string; // accountA の紐づけ生徒（在籍中）
let studentBId: string; // 別アカウントの生徒（見えてはいけない）
let studentCId: string; // accountA の紐づけ生徒だが退塾超過（見えてはいけない）

let accountAId: string;
let accountBId: string;
let strangerAccountId: string; // 紐づけを1件も持たないアカウント
let otherSchoolId: string; // 別教室（講師名ビューの越境検証用）
let otherTeacherUserId: string; // 別教室に所属する講師

let entryAId: string;
let entryBId: string;
let entryCId: string;

const uniq = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  admin = getAdminClient();
  const school = await createTestSchool(admin, { name: 'ポータル予定教室' });
  schoolId = school.id;

  // 講師（schedule_entries.teacher_id は NOT NULL・user_profiles 参照）。
  const teacher = await createTestUser(admin, { role: 'teacher', schoolIds: [schoolId] });
  teacherUserId = teacher.userId;
  // 限定公開ビューは is_active=true・display_name のみを出す。表示名を入れておく。
  await admin
    .from('user_profiles')
    .update({ display_name: 'テスト講師', is_active: true })
    .eq('id', teacherUserId);

  // 時限マスタ
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

  // 教科
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
        student_code: `PSCH_${u}`,
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
  // 退塾日が過去 = 失効済み（昨日で退塾）。
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
  accountAId = await mkAccount('保護者A');
  accountBId = await mkAccount('保護者B');
  // 紐づけを1件も持たないアカウント（限定公開ビューの列挙を試す用）。
  strangerAccountId = await mkAccount('紐づけ無し');

  // 別教室＋そこに所属する講師（講師名ビューが教室を越えないことの検証用）。
  const otherSchool = await createTestSchool(admin, { name: 'ポータル予定・別教室' });
  otherSchoolId = otherSchool.id;
  const otherTeacher = await createTestUser(admin, { role: 'teacher', schoolIds: [otherSchoolId] });
  otherTeacherUserId = otherTeacher.userId;
  await admin
    .from('user_profiles')
    .update({ display_name: '別教室の講師', is_active: true })
    .eq('id', otherTeacherUserId);

  await admin.from('portal_account_students').insert([
    { account_id: accountAId, student_id: studentAId, relation: 'mother' },
    // accountA は退塾済みのCにも紐づく（紐づけは残るが予定は見えない、を検証する）。
    { account_id: accountAId, student_id: studentCId, relation: 'mother' },
    { account_id: accountBId, student_id: studentBId, relation: 'father' },
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
        status: 'scheduled',
        kind: 'regular',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`予定作成失敗: ${error?.message}`);
    return data.id as string;
  };
  entryAId = await mkEntry(studentAId, '2026-07-15');
  entryBId = await mkEntry(studentBId, '2026-07-16');
  entryCId = await mkEntry(studentCId, '2026-07-17');

  // 例外テーブルの行（portal から読めないことの検証用）。
  await admin.from('portal_transfer_permissions').insert({
    school_id: schoolId,
    student_id: studentAId,
    month: '2026-07-01',
    extra_count: 1,
  });
  await admin.from('transfer_free_periods').insert({
    school_id: schoolId,
    start_date: '2026-07-22',
    end_date: '2026-08-09',
    label: '夏期講習前期間',
  });
});

afterAll(async () => {
  if (!admin) return;
  await admin.from('transfer_free_periods').delete().eq('school_id', schoolId);
  await admin.from('portal_transfer_permissions').delete().eq('school_id', schoolId);
  await admin.from('schedule_entries').delete().eq('school_id', schoolId);
  await admin
    .from('portal_account_students')
    .delete()
    .in('account_id', [accountAId, accountBId, strangerAccountId]);
  await admin
    .from('portal_accounts')
    .delete()
    .in('id', [accountAId, accountBId, strangerAccountId]);
  await admin.from('students').delete().eq('school_id', schoolId);
  await admin.from('schedule_time_slots').delete().eq('school_id', schoolId);
  await admin.from('subjects').delete().eq('id', subjectId);
  if (teacherUserId) await cleanupTestUser(admin, teacherUserId);
  if (otherTeacherUserId) await cleanupTestUser(admin, otherTeacherUserId);
  if (otherSchoolId) await cleanupTestSchool(admin, otherSchoolId);
  await cleanupTestSchool(admin, schoolId);
});

describe('schedule_entries: 自分の紐づけ生徒の予定だけ可視', () => {
  it('accountA は studentA の予定を読める', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from schedule_entries where id = any($1)',
      [[entryAId, entryBId, entryCId]]
    );
    expect(rows.map((r) => r.id)).toContain(entryAId);
  });

  it('accountA は他アカウントの生徒(studentB)の予定を読めない', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from schedule_entries where id = any($1)',
      [[entryAId, entryBId, entryCId]]
    );
    expect(rows.map((r) => r.id)).not.toContain(entryBId);
  });

  it('★ 退塾日を過ぎた紐づけ生徒(studentC)の予定は読めない（失効）', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from schedule_entries where id = any($1)',
      [[entryAId, entryBId, entryCId]]
    );
    expect(rows.map((r) => r.id)).not.toContain(entryCId);
  });

  it('accountB は studentB の予定のみ読める', async () => {
    const rows = await selectAs(
      'portal',
      accountBId,
      'select id from schedule_entries where id = any($1)',
      [[entryAId, entryBId, entryCId]]
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(entryBId);
    expect(ids).not.toContain(entryAId);
  });

  it('anon は schedule_entries を読めない（0件 or エラー）', async () => {
    const count = await tryCountAs('anon', null, 'select id from schedule_entries limit 1');
    expect(count === 0 || count === -1).toBe(true);
  });
});

describe('振替の例外テーブル: portal はデフォルト拒否のまま', () => {
  it('portal は portal_transfer_permissions を読めない（grant なし）', async () => {
    const count = await tryCountAs(
      'portal',
      accountAId,
      'select id from portal_transfer_permissions limit 1'
    );
    // grant していないので permission denied(-1) を期待。
    expect(count).toBe(-1);
  });

  it('portal は transfer_free_periods を読めない（grant なし）', async () => {
    const count = await tryCountAs(
      'portal',
      accountAId,
      'select id from transfer_free_periods limit 1'
    );
    expect(count).toBe(-1);
  });

  it('★ portal は schedule_regular_patterns を読めない（素の座席表テーブルを開けない）', async () => {
    const count = await tryCountAs(
      'portal',
      accountAId,
      'select id from schedule_regular_patterns limit 1'
    );
    expect(count).toBe(-1);
  });
});

describe('講師名: 限定公開ビューだけが読める', () => {
  it('portal は portal_teacher_names を読める', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id, display_name from portal_teacher_names where id = $1',
      [teacherUserId]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].display_name).toBe('テスト講師');
  });

  // ★ 2026-07-14 レビューで是正した越境露出の回帰テスト。
  // ビューには RLS を掛けられず所有者権限で評価されるため、述語で絞らないと
  // 「全教室の全スタッフ（オーナー・管理者含む）の氏名を誰でも列挙できる」状態になる。
  it('★ 他教室のスタッフ名は見えない（教室スコープ）', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from portal_teacher_names where id = $1',
      [otherTeacherUserId]
    );
    expect(rows.length).toBe(0);
  });

  it('★ 紐づけを持たないアカウントは1人も列挙できない', async () => {
    const rows = await selectAs('portal', strangerAccountId, 'select id from portal_teacher_names');
    expect(rows.length).toBe(0);
  });

  it('★ portal は user_profiles 本体を読めない（メール等のPIIを開けない）', async () => {
    const count = await tryCountAs('portal', accountAId, 'select id from user_profiles limit 1');
    expect(count).toBe(-1);
  });
});

describe('予定表示に必要なマスタ', () => {
  it('portal は自校の schedule_time_slots を読める', async () => {
    const rows = await selectAs(
      'portal',
      accountAId,
      'select id from schedule_time_slots where id = $1',
      [slotId]
    );
    expect(rows.length).toBe(1);
  });

  it('portal は subjects を読める（教科名は機微でない）', async () => {
    const rows = await selectAs('portal', accountAId, 'select id from subjects where id = $1', [
      subjectId,
    ]);
    expect(rows.length).toBe(1);
  });
});
