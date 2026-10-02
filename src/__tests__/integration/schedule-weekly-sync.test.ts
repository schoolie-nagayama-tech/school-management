/**
 * 統合テスト: 座席表の週の再生成が報告書を消さないこと（2026-10-01）。
 *
 * 以前の generateWeeklySchedule は対象週を全削除→再INSERTしていたため、
 * class_reports（ON DELETE CASCADE）が再生成のたびに連鎖で消えていた。
 * 差分反映（src/lib/schedule/weeklySync.ts）と外部キーの NO ACTION 化
 * （20261001120000_class_reports_keep_on_entry_delete.sql）を、本物の関数・本物の DB で確かめる。
 *
 * 保証:
 *   1. 再生成しても既存の行の id が変わらない（報告書が残る）。
 *   2. 報告書付きの行は、通塾日程から外れても消えず、書き換えられない。
 *   3. 報告書の無い行は、通塾日程の変更が差分で反映される。
 *   4. 凍結した行はズレ検知の「古い行」に数えない（自動再生成の空回り防止）。
 *   5. 報告書付きの行を直接消そうとすると DB が 23503 で止める。
 *   6. 生徒の削除はこれまでどおり報告書ごと消える（NO ACTION は文末検査）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient, createTestSchool, cleanupTestSchool } from './helpers';
import { createTestUser, cleanupTestUser } from './rls-helpers';

// schedule.ts はブラウザ用クライアントを使う。ここではローカル DB の service role に差し替える。
vi.mock('@/lib/supabase', async () => {
  const { getAdminClient: mk } = await import('./helpers');
  return { supabase: mk() };
});

import { generateWeeklySchedule, detectScheduleDrift } from '@/lib/api/schedule';

// 2026-10-05 は月曜。パターンは火曜（day_of_week=2）＝ 2026-10-06。
const WEEK = '2026-10-05';
const LESSON_DATE = '2026-10-06';

let admin: SupabaseClient;
let schoolId: string;
let teacherUserId: string;
let slotId: string;
let subjectMathId: string;
let subjectEngId: string;
let studentReportedId: string;
let studentPlainId: string;
let patternReportedId: string;
let patternPlainId: string;

const uniq = () => Math.random().toString(36).slice(2, 8);

async function entriesOf(studentId: string) {
  const { data, error } = await admin
    .from('schedule_entries')
    .select('id, subject_ids, status')
    .eq('school_id', schoolId)
    .eq('student_id', studentId);
  if (error) throw new Error(error.message);
  return data as Array<{ id: string; subject_ids: string[]; status: string }>;
}

beforeAll(async () => {
  admin = getAdminClient();
  schoolId = (await createTestSchool(admin, { name: '再生成テスト教室' })).id;
  teacherUserId = (await createTestUser(admin, { role: 'teacher', schoolIds: [schoolId] })).userId;

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

  const mkSubject = async () => {
    const { data, error } = await admin
      .from('subjects')
      .insert({ name: `教科${uniq()}`, grade_category: 'middle' })
      .select('id')
      .single();
    if (error || !data) throw new Error(`教科作成失敗: ${error?.message}`);
    return data.id as string;
  };
  subjectMathId = await mkSubject();
  subjectEngId = await mkSubject();

  const mkStudent = async () => {
    const u = uniq();
    const { data, error } = await admin
      .from('students')
      .insert({
        school_id: schoolId,
        student_code: `SYNC_${u}`,
        last_name: `姓${u}`,
        first_name: `名${u}`,
        last_name_kana: 'セイ',
        first_name_kana: 'メイ',
        grade: 8,
        status: 'active',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`生徒作成失敗: ${error?.message}`);
    return data.id as string;
  };
  studentReportedId = await mkStudent();
  studentPlainId = await mkStudent();

  const mkPattern = async (studentId: string) => {
    const { data, error } = await admin
      .from('schedule_regular_patterns')
      .insert({
        school_id: schoolId,
        student_id: studentId,
        teacher_id: teacherUserId,
        day_of_week: 2,
        time_slot_id: slotId,
        subject_ids: [subjectMathId],
        is_active: true,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`通塾日程作成失敗: ${error?.message}`);
    return data.id as string;
  };
  patternReportedId = await mkPattern(studentReportedId);
  patternPlainId = await mkPattern(studentPlainId);
});

afterAll(async () => {
  if (!admin) return;
  await admin.from('class_reports').delete().eq('school_id', schoolId);
  await admin.from('schedule_entries').delete().eq('school_id', schoolId);
  await admin.from('schedule_regular_patterns').delete().eq('school_id', schoolId);
  await admin.from('schedule_generation_logs').delete().eq('school_id', schoolId);
  await admin.from('schedule_time_slots').delete().eq('school_id', schoolId);
  await admin.from('subjects').delete().in('id', [subjectMathId, subjectEngId]);
  if (teacherUserId) await cleanupTestUser(admin, teacherUserId);
  await cleanupTestSchool(admin, schoolId);
});

describe('座席表の週の再生成（差分反映）', () => {
  let reportedEntryId: string;
  let plainEntryId: string;

  it('初回の生成で通塾日程どおりのコマができる', async () => {
    const result = await generateWeeklySchedule(schoolId, WEEK);
    expect(result.entries_created).toBe(2);
    expect(result.inserted).toBe(2);

    const [r] = await entriesOf(studentReportedId);
    const [p] = await entriesOf(studentPlainId);
    reportedEntryId = r.id;
    plainEntryId = p.id;
  });

  it('変更が無ければ再生成しても行の id が変わらない', async () => {
    const result = await generateWeeklySchedule(schoolId, WEEK);
    expect(result).toMatchObject({ entries_created: 2, inserted: 0, updated: 0, deleted: 0 });
    expect((await entriesOf(studentReportedId))[0].id).toBe(reportedEntryId);
    expect((await entriesOf(studentPlainId))[0].id).toBe(plainEntryId);
  });

  it('報告書付きの行は、通塾日程から外れても残り、報告書も消えない', async () => {
    const { error: repErr } = await admin.from('class_reports').insert({
      school_id: schoolId,
      schedule_entry_id: reportedEntryId,
      student_id: studentReportedId,
      teacher_id: teacherUserId,
      lesson_date: LESSON_DATE,
      status: 'approved',
    });
    if (repErr) throw new Error(`報告書作成失敗: ${repErr.message}`);

    // 報告書のある生徒は通塾日程を止め、無い生徒は科目を変える
    await admin
      .from('schedule_regular_patterns')
      .update({ is_active: false })
      .eq('id', patternReportedId);
    await admin
      .from('schedule_regular_patterns')
      .update({ subject_ids: [subjectEngId] })
      .eq('id', patternPlainId);

    const result = await generateWeeklySchedule(schoolId, WEEK);
    expect(result).toMatchObject({ inserted: 0, updated: 1, deleted: 0, kept_frozen: 1 });

    const reported = await entriesOf(studentReportedId);
    expect(reported.map((e) => e.id)).toEqual([reportedEntryId]);
    const { count } = await admin
      .from('class_reports')
      .select('id', { count: 'exact', head: true })
      .eq('schedule_entry_id', reportedEntryId);
    expect(count).toBe(1);

    const plain = await entriesOf(studentPlainId);
    expect(plain).toEqual([{ id: plainEntryId, subject_ids: [subjectEngId], status: 'scheduled' }]);
  });

  it('凍結した行はズレ検知の「古い行」に数えない', async () => {
    const drifts = await detectScheduleDrift(schoolId, WEEK, 1);
    expect(drifts).toEqual([]);
  });

  it('報告書付きの行を直接消そうとすると DB が止める', async () => {
    const { error } = await admin.from('schedule_entries').delete().eq('id', reportedEntryId);
    expect(error?.code).toBe('23503');
    expect(await entriesOf(studentReportedId)).toHaveLength(1);
  });

  it('生徒の削除はこれまでどおり報告書ごと消える', async () => {
    const { error } = await admin.from('students').delete().eq('id', studentReportedId);
    expect(error).toBeNull();
    const { count } = await admin
      .from('class_reports')
      .select('id', { count: 'exact', head: true })
      .eq('schedule_entry_id', reportedEntryId);
    expect(count).toBe(0);
  });
});
