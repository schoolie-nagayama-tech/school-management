/**
 * 統合テスト: 権限昇格・部外者アクセスの回帰テスト
 *
 * 目的（2026-09-30 セキュリティ総点検）:
 *   ブラウザの公開キーで PostgREST を直接叩くだけで、次のことができていた。
 *   マイグレーション 20260930120000_security_block_privilege_escalation.sql で塞いだので、
 *   誰かがポリシーやトリガーを「整理」して穴を戻したら、ここで落ちるようにする。
 *
 *   1. 講師が自分の role を admin に書き換える
 *   2. 教室長が講師を admin に昇格させる／自分を他教室に割り当てる／admin の招待を作る
 *   3. 未ログインで講師名簿（user_profiles）を読む
 *   4. 新規登録しただけの人（プロフィール無し）が自分を admin で作る／マスタを読む・消す
 *   5. 教室長が監査ログを消す
 *
 * あわせて、画面から直接行っている正規の操作（本人の表示名変更、教室長による講師の
 * 無効化・担当教室への割当）が今までどおり通ることも確かめる。
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

let adminClient: SupabaseClient;
let schoolAId: string;
let schoolBId: string;

let teacherA: TestUser; // 教室A
let teacherB: TestUser; // 教室B
let managerA: TestUser; // 教室A の教室長
let outsider: { userId: string; email: string; password: string }; // プロフィール無し

let teacherAClient: SupabaseClient;
let managerAClient: SupabaseClient;
let outsiderClient: SupabaseClient;

let subjectId: string;
let auditLogId: string;

beforeAll(async () => {
  adminClient = getAdminClient();

  schoolAId = (await createTestSchool(adminClient)).id;
  schoolBId = (await createTestSchool(adminClient)).id;

  teacherA = await createTestUser(adminClient, { role: 'teacher', schoolIds: [schoolAId] });
  teacherB = await createTestUser(adminClient, { role: 'teacher', schoolIds: [schoolBId] });
  managerA = await createTestUser(adminClient, { role: 'manager', schoolIds: [schoolAId] });

  // 新規登録しただけの人: Auth ユーザーはあるがプロフィールが無い
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `rls_outsider_${suffix}@example.com`;
  const password = 'Test1234!';
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !authData.user) throw new Error(`部外者の作成に失敗: ${authError?.message}`);
  outsider = { userId: authData.user.id, email, password };

  teacherAClient = await signInAsUser(teacherA.email, teacherA.password);
  managerAClient = await signInAsUser(managerA.email, managerA.password);
  outsiderClient = await signInAsUser(outsider.email, outsider.password);

  const { data: subject, error: subjectError } = await adminClient
    .from('subjects')
    .insert({ name: `権限テスト科目_${suffix}`, grade_category: 'middle' })
    .select('id')
    .single();
  if (subjectError || !subject) throw new Error(`科目の作成に失敗: ${subjectError?.message}`);
  subjectId = subject.id;

  const { data: log, error: logError } = await adminClient
    .from('admin_audit_logs')
    .insert({
      actor_id: managerA.userId,
      actor_role: 'manager',
      action: 'rls_test',
      target_type: 'test',
    })
    .select('id')
    .single();
  if (logError || !log) throw new Error(`監査ログの作成に失敗: ${logError?.message}`);
  auditLogId = log.id;
});

afterAll(async () => {
  await adminClient.from('admin_audit_logs').delete().eq('id', auditLogId);
  await adminClient.from('subjects').delete().eq('id', subjectId);
  await adminClient.from('user_invitations').delete().eq('invited_by', managerA.userId);
  for (const u of [teacherA, teacherB, managerA]) await cleanupTestUser(adminClient, u.userId);
  await adminClient.from('user_profiles').delete().eq('id', outsider.userId);
  await adminClient.auth.admin.deleteUser(outsider.userId);
  await cleanupTestSchool(adminClient, schoolAId);
  await cleanupTestSchool(adminClient, schoolBId);
});

async function roleOf(userId: string): Promise<string | null> {
  const { data } = await adminClient
    .from('user_profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  return (data?.role as string | undefined) ?? null;
}

describe('user_profiles: ロールを上げられない', () => {
  it('講師は自分の role を admin に書き換えられない', async () => {
    const { error } = await teacherAClient
      .from('user_profiles')
      .update({ role: 'admin' })
      .eq('id', teacherA.userId);
    expect(error).not.toBeNull();
    expect(await roleOf(teacherA.userId)).toBe('teacher');
  });

  it('講師は自分の表示名なら変えられる（正規の操作）', async () => {
    const { error } = await teacherAClient
      .from('user_profiles')
      .update({ display_name: '権限テスト講師' })
      .eq('id', teacherA.userId);
    expect(error).toBeNull();
  });

  it('教室長は講師を admin に昇格させられない', async () => {
    const { error } = await managerAClient
      .from('user_profiles')
      .update({ role: 'admin' })
      .eq('id', teacherA.userId);
    expect(error).not.toBeNull();
    expect(await roleOf(teacherA.userId)).toBe('teacher');
  });

  it('教室長は講師を無効化できる（正規の操作）', async () => {
    const { error } = await managerAClient
      .from('user_profiles')
      .update({ is_active: false })
      .eq('id', teacherA.userId);
    expect(error).toBeNull();
    await adminClient.from('user_profiles').update({ is_active: true }).eq('id', teacherA.userId);
  });

  it('新規登録しただけの人は、自分を admin として作れない', async () => {
    const { error } = await outsiderClient
      .from('user_profiles')
      .insert({ id: outsider.userId, email: outsider.email, role: 'admin' });
    expect(error).not.toBeNull();
    expect(await roleOf(outsider.userId)).toBeNull();
  });

  it('講師は同僚の講師の名前を読める（講師画面の既読集計・時間割で使う）', async () => {
    const { data } = await teacherAClient
      .from('user_profiles')
      .select('id')
      .eq('id', teacherB.userId);
    expect(data ?? []).toHaveLength(1);
  });

  it('新規登録しただけの人は講師名簿を読めない', async () => {
    const { data } = await outsiderClient
      .from('user_profiles')
      .select('id')
      .eq('id', teacherB.userId);
    expect(data ?? []).toHaveLength(0);
  });

  it('未ログインでは講師名簿を読めない', async () => {
    const { data, error } = await getAnonClient().from('user_profiles').select('id, email');
    // 権限エラー（revoke 済み）か 0 件のどちらか。1件でも見えたら穴が戻っている。
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});

describe('user_schools: 教室スコープを広げられない', () => {
  it('教室長は自分を他教室に割り当てられない', async () => {
    const { error } = await managerAClient
      .from('user_schools')
      .insert({ user_id: managerA.userId, school_id: schoolBId });
    expect(error).not.toBeNull();
  });

  it('教室長は担当外の教室に講師を割り当てられない', async () => {
    const { error } = await managerAClient
      .from('user_schools')
      .insert({ user_id: teacherA.userId, school_id: schoolBId });
    expect(error).not.toBeNull();
  });

  it('教室長は担当教室に講師を割り当てられる（正規の操作）', async () => {
    const { error } = await managerAClient
      .from('user_schools')
      .insert({ user_id: teacherB.userId, school_id: schoolAId });
    expect(error).toBeNull();
    await adminClient
      .from('user_schools')
      .delete()
      .eq('user_id', teacherB.userId)
      .eq('school_id', schoolAId);
  });
});

describe('user_invitations: 上位ロールの招待を作れない', () => {
  it('教室長は admin の招待を作れない', async () => {
    const { error } = await managerAClient.from('user_invitations').insert({
      email: `rls_invite_${Date.now()}@example.com`,
      role: 'admin',
      token: `rls_test_${Math.random().toString(36).slice(2)}`,
      invited_by: managerA.userId,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(error).not.toBeNull();
  });
});

describe('マスタ: 新規登録しただけの人は触れない', () => {
  it('科目を読めない（講師は読める）', async () => {
    const { data: outsiderRows } = await outsiderClient
      .from('subjects')
      .select('id')
      .eq('id', subjectId);
    expect(outsiderRows ?? []).toHaveLength(0);

    const { data: teacherRows } = await teacherAClient
      .from('subjects')
      .select('id')
      .eq('id', subjectId);
    expect(teacherRows ?? []).toHaveLength(1);
  });

  it('科目を削除できない', async () => {
    await outsiderClient.from('subjects').delete().eq('id', subjectId);
    const { data } = await adminClient.from('subjects').select('id').eq('id', subjectId);
    expect(data ?? []).toHaveLength(1);
  });
});

describe('admin_audit_logs: 監査ログは読むだけ', () => {
  it('教室長は監査ログを読めるが、消せない', async () => {
    const { data: rows } = await managerAClient
      .from('admin_audit_logs')
      .select('id')
      .eq('id', auditLogId);
    expect(rows ?? []).toHaveLength(1);

    await managerAClient.from('admin_audit_logs').delete().eq('id', auditLogId);
    const { data } = await adminClient.from('admin_audit_logs').select('id').eq('id', auditLogId);
    expect(data ?? []).toHaveLength(1);
  });
});
