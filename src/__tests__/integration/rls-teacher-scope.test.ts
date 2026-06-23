/**
 * 統合テスト: RLS 教室スコープ回帰テスト
 *
 * 目的:
 *   講師リリースに向けて大量のRLS変更を本番適用したあと、
 *   ロール別アクセス制御が正しく機能していることを自動検証する。
 *
 * 検証するポリシー:
 *   1. student_interviews: check_school_access(school_id) で教室スコープ化
 *      - teacher は自教室のみ見える
 *      - manager は全教室が見える
 *      - anon(未ログイン) は0件(または SELECT エラー)
 *
 *   2. attendance_sheets: RESTRICTIVE(教室スコープ) + PERMISSIVE(teacher_id=auth.uid())
 *      - teacher は自分の sheet のみ見える（他の teacher の sheet は見えない）
 *      - manager は全教室・全 teacher の sheet が見える
 *
 * 実行前提:
 *   supabase start 済み、.env.test に接続情報が設定されていること
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient, createTestSchool, cleanupTestSchool } from './helpers';
import {
  getAnonClient,
  createTestUser,
  signInAsUser,
  cleanupTestUser,
  type TestUser,
} from './rls-helpers';

// ── シードデータの参照を保持するための変数 ──
let adminClient: SupabaseClient;

// 教室
let schoolAId: string;
let schoolBId: string;

// 生徒
let studentAId: string; // 教室A の生徒
let studentBId: string; // 教室B の生徒

// 面談記録
let interviewAId: string; // 教室A の面談
let interviewBId: string; // 教室B の面談

// 出勤簿
let sheetTeacherAId: string; // teacherA 自身の出勤簿 (教室A)
let sheetTeacherBId: string; // teacherB の出勤簿 (教室A 同一教室・別講師)

// テストユーザー
let teacherAUser: TestUser; // 教室A のみに所属する teacher
let teacherBUser: TestUser; // 教室A のみに所属する別の teacher
let managerUser: TestUser; // manager（教室紐づけなし → check_school_access で全教室TRUE）

// ── beforeAll: service_role でシードデータを作成 ──
beforeAll(async () => {
  adminClient = getAdminClient();

  // ── 教室の作成 ──
  const schoolA = await createTestSchool(adminClient, { name: 'テスト教室A_RLS' });
  const schoolB = await createTestSchool(adminClient, { name: 'テスト教室B_RLS' });
  schoolAId = schoolA.id;
  schoolBId = schoolB.id;

  // ── 生徒の作成 ──
  const uniqueA = Math.random().toString(36).slice(2, 8);
  const uniqueB = Math.random().toString(36).slice(2, 8);

  // students は student_code / last_name_kana / first_name_kana も NOT NULL のため必ず埋める
  const { data: studentA, error: errA } = await adminClient
    .from('students')
    .insert({
      school_id: schoolAId,
      student_code: `RLSA_${uniqueA}`,
      last_name: `RLS姓A${uniqueA}`,
      first_name: `RLS名A${uniqueA}`,
      last_name_kana: 'アールエルエスエー',
      first_name_kana: 'テスト',
      grade: 1,
      status: 'active',
    })
    .select('id')
    .single();
  if (errA || !studentA) throw new Error(`生徒A作成失敗: ${errA?.message}`);
  studentAId = studentA.id;

  const { data: studentB, error: errB } = await adminClient
    .from('students')
    .insert({
      school_id: schoolBId,
      student_code: `RLSB_${uniqueB}`,
      last_name: `RLS姓B${uniqueB}`,
      first_name: `RLS名B${uniqueB}`,
      last_name_kana: 'アールエルエスビー',
      first_name_kana: 'テスト',
      grade: 1,
      status: 'active',
    })
    .select('id')
    .single();
  if (errB || !studentB) throw new Error(`生徒B作成失敗: ${errB?.message}`);
  studentBId = studentB.id;

  // ── 面談記録の作成（student_interviews） ──
  //    必須列: school_id, student_id, interview_date, interview_type, content
  const { data: ivA, error: ivErrA } = await adminClient
    .from('student_interviews')
    .insert({
      school_id: schoolAId,
      student_id: studentAId,
      interview_date: '2026-06-15',
      interview_type: 'parent_interview',
      content: 'RLSテスト用面談A',
    })
    .select('id')
    .single();
  if (ivErrA || !ivA) throw new Error(`面談A作成失敗: ${ivErrA?.message}`);
  interviewAId = ivA.id;

  const { data: ivB, error: ivErrB } = await adminClient
    .from('student_interviews')
    .insert({
      school_id: schoolBId,
      student_id: studentBId,
      interview_date: '2026-06-15',
      interview_type: 'parent_interview',
      content: 'RLSテスト用面談B',
    })
    .select('id')
    .single();
  if (ivErrB || !ivB) throw new Error(`面談B作成失敗: ${ivErrB?.message}`);
  interviewBId = ivB.id;

  // ── テストユーザーの作成 ──
  teacherAUser = await createTestUser(adminClient, {
    role: 'teacher',
    schoolIds: [schoolAId],
  });
  teacherBUser = await createTestUser(adminClient, {
    role: 'teacher',
    schoolIds: [schoolAId], // 同じ教室Aに所属するが別の teacher
  });
  managerUser = await createTestUser(adminClient, {
    role: 'manager',
    // manager は check_school_access が常にTRUE → schoolIds 不要
  });

  // ── 出勤簿の作成（attendance_sheets） ──
  //    teacher_id が重要（PERMISSIVE "teacher_own" = teacher_id = auth.uid()）
  const yearMonth = '2026-06';

  const { data: sheetA, error: sheetErrA } = await adminClient
    .from('attendance_sheets')
    .insert({
      teacher_id: teacherAUser.userId,
      school_id: schoolAId,
      year_month: yearMonth,
      status: 'draft',
    })
    .select('id')
    .single();
  if (sheetErrA || !sheetA) throw new Error(`出勤簿A作成失敗: ${sheetErrA?.message}`);
  sheetTeacherAId = sheetA.id;

  const { data: sheetB, error: sheetErrB } = await adminClient
    .from('attendance_sheets')
    .insert({
      teacher_id: teacherBUser.userId,
      school_id: schoolAId,
      year_month: yearMonth,
      status: 'draft',
    })
    .select('id')
    .single();
  if (sheetErrB || !sheetB) throw new Error(`出勤簿B作成失敗: ${sheetErrB?.message}`);
  sheetTeacherBId = sheetB.id;
});

// ── afterAll: 作成した全データを逆順でクリーンアップ ──
afterAll(async () => {
  if (!adminClient) return;

  // 出勤簿
  if (sheetTeacherAId) {
    await adminClient.from('attendance_sheets').delete().eq('id', sheetTeacherAId);
  }
  if (sheetTeacherBId) {
    await adminClient.from('attendance_sheets').delete().eq('id', sheetTeacherBId);
  }

  // 面談記録
  if (interviewAId) {
    await adminClient.from('student_interviews').delete().eq('id', interviewAId);
  }
  if (interviewBId) {
    await adminClient.from('student_interviews').delete().eq('id', interviewBId);
  }

  // テストユーザー
  if (teacherAUser?.userId) await cleanupTestUser(adminClient, teacherAUser.userId);
  if (teacherBUser?.userId) await cleanupTestUser(adminClient, teacherBUser.userId);
  if (managerUser?.userId) await cleanupTestUser(adminClient, managerUser.userId);

  // 生徒・教室（CASCADE で student_logs 等も削除される）
  if (studentAId) await adminClient.from('students').delete().eq('id', studentAId);
  if (studentBId) await adminClient.from('students').delete().eq('id', studentBId);
  if (schoolAId) await cleanupTestSchool(adminClient, schoolAId);
  if (schoolBId) await cleanupTestSchool(adminClient, schoolBId);
});

// ================================================================
// テストスイート1: student_interviews の教室スコープRLS
// ================================================================
describe('student_interviews RLS: 教室スコープ検証', () => {
  /**
   * 保証:
   *   check_school_access(school_id) ポリシーにより、
   *   teacher は user_schools に紐づく教室の面談のみ SELECT できること
   */
  it('teacher(教室A所属)は教室Aの面談のみ取得できる（教室Bは見えない）', async () => {
    const client = await signInAsUser(teacherAUser.email, teacherAUser.password);
    const { data, error } = await client
      .from('student_interviews')
      .select('id, school_id')
      // テストデータのみに絞る（他テストの残骸に影響されない）
      .in('id', [interviewAId, interviewBId]);

    expect(error).toBeNull();
    expect(data).not.toBeNull();

    const ids = data!.map((r) => r.id);
    expect(ids).toContain(interviewAId);
    expect(ids).not.toContain(interviewBId);

    // 返った行が全て教室Aであること
    for (const row of data!) {
      expect(row.school_id).toBe(schoolAId);
    }
  });

  /**
   * 保証:
   *   manager は check_school_access が常にTRUE を返すため、
   *   教室A・教室B 両方の面談を SELECT できること
   */
  it('manager は全教室の面談を取得できる（教室A・B 両方）', async () => {
    const client = await signInAsUser(managerUser.email, managerUser.password);
    const { data, error } = await client
      .from('student_interviews')
      .select('id, school_id')
      .in('id', [interviewAId, interviewBId]);

    expect(error).toBeNull();
    expect(data).not.toBeNull();

    const ids = data!.map((r) => r.id);
    expect(ids).toContain(interviewAId);
    expect(ids).toContain(interviewBId);
  });

  /**
   * 保証:
   *   anon(未ログイン)クライアントは student_interviews を SELECT できないこと。
   *   zzz_20260529_rls_anon_lockdown.sql で anon ポリシーを削除済みのため、
   *   行が返らない(0件)か SELECT エラーとなる。
   */
  it('匿名クライアントは student_interviews を取得できない（0件またはエラー）', async () => {
    const client = getAnonClient();
    const { data, error } = await client
      .from('student_interviews')
      .select('id')
      .in('id', [interviewAId, interviewBId]);

    // エラーか 0件のどちらかであれば OK
    if (error) {
      // RLS が DENY した場合は permission エラー等が返る
      expect(error).toBeTruthy();
    } else {
      expect(data).toHaveLength(0);
    }
  });
});

// ================================================================
// テストスイート2: attendance_sheets の RESTRICTIVE+PERMISSIVE RLS
// ================================================================
describe('attendance_sheets RLS: 本人限定スコープ検証', () => {
  /**
   * 保証:
   *   RESTRICTIVE(check_school_access) AND PERMISSIVE(teacher_id=auth.uid()) により、
   *   teacher は自分が teacher_id である sheet のみ SELECT できること
   */
  it('teacherA は自分の出勤簿のみ取得できる（teacherBの出勤簿は見えない）', async () => {
    const client = await signInAsUser(teacherAUser.email, teacherAUser.password);
    const { data, error } = await client
      .from('attendance_sheets')
      .select('id, teacher_id, school_id')
      .in('id', [sheetTeacherAId, sheetTeacherBId]);

    expect(error).toBeNull();
    expect(data).not.toBeNull();

    const ids = data!.map((r) => r.id);
    expect(ids).toContain(sheetTeacherAId);
    expect(ids).not.toContain(sheetTeacherBId);

    // 返った行の teacher_id が全て teacherA であること
    for (const row of data!) {
      expect(row.teacher_id).toBe(teacherAUser.userId);
    }
  });

  /**
   * 保証:
   *   manager は attendance_sheets_manager_all ポリシーにより
   *   全 teacher の出勤簿を SELECT できること
   */
  it('manager は同一教室の全 teacher の出勤簿を取得できる', async () => {
    const client = await signInAsUser(managerUser.email, managerUser.password);
    const { data, error } = await client
      .from('attendance_sheets')
      .select('id, teacher_id, school_id')
      .in('id', [sheetTeacherAId, sheetTeacherBId]);

    expect(error).toBeNull();
    expect(data).not.toBeNull();

    const ids = data!.map((r) => r.id);
    expect(ids).toContain(sheetTeacherAId);
    expect(ids).toContain(sheetTeacherBId);
  });

  /**
   * 保証:
   *   anon(未ログイン)クライアントは attendance_sheets を SELECT できないこと。
   *   20260615_rls_teacher_scope_attendance.sql で TO authenticated に変更済みのため、
   *   anon ロールは対象外。
   */
  it('匿名クライアントは attendance_sheets を取得できない（0件またはエラー）', async () => {
    const client = getAnonClient();
    const { data, error } = await client
      .from('attendance_sheets')
      .select('id')
      .in('id', [sheetTeacherAId, sheetTeacherBId]);

    if (error) {
      expect(error).toBeTruthy();
    } else {
      expect(data).toHaveLength(0);
    }
  });
});
