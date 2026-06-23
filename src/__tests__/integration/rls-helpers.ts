/**
 * RLS回帰テスト用ヘルパー
 *
 * 認証済みロール別クライアントを作成・破棄するユーティリティ。
 * テストコードが Supabase の RLS をロール(teacher/manager/anon)ごとに
 * 実際に通過して検証できるようにする。
 *
 * 仕組み:
 *   - service_role クライアント(admin)でユーザーを作成
 *   - anon クライアントで signInWithPassword してトークンを取得
 *   - そのトークンを Authorization ヘッダに付けた anon クライアントを返す
 *   - このクライアントのリクエストは DB 上で "authenticated" ロール + auth.uid() として
 *     実行されるため、RLS ポリシーが正しく評価される
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// setup.ts と同じ .env.test を読み込む
dotenv.config({ path: path.resolve(__dirname, '../../../.env.test') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// anon キーのみで作ったクライアントを使う (.env.test のキー名に合わせる)
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** createTestUser の引数型 */
export interface CreateTestUserOptions {
  /** user_profiles.role に設定するロール */
  role: 'admin' | 'owner' | 'manager' | 'teacher' | 'parent';
  /** user_schools に紐づける教室IDの配列。省略すると紐づけなし */
  schoolIds?: string[];
}

/** createTestUser の戻り値 */
export interface TestUser {
  userId: string;
  email: string;
  password: string;
}

/**
 * 匿名(anon)クライアントを返す。
 * RLS の「anon ロール」テストに使う。
 */
export function getAnonClient(): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
  });
}

/**
 * テスト用ユーザーを作成し、その認証情報を返す。
 *
 * 1. auth.admin.createUser でメールアドレス確認済みユーザーを作成
 * 2. user_profiles に role を insert
 * 3. schoolIds があれば user_schools に紐づけを insert
 *
 * @param admin  service_role クライアント（RLS バイパス）
 * @param opts   role と schoolIds
 */
export async function createTestUser(
  admin: SupabaseClient,
  opts: CreateTestUserOptions
): Promise<TestUser> {
  const uniqueSuffix = Math.random().toString(36).slice(2, 10);
  const email = `rls_test_${uniqueSuffix}@example.com`;
  const password = 'Test1234!';

  // ── 1. Auth ユーザー作成（email_confirm: true で即確認済み）
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !authData.user) {
    throw new Error(`テストユーザー(Auth)の作成に失敗: ${authError?.message}`);
  }
  const userId = authData.user.id;

  // ── 2. user_profiles を insert
  //    handle_new_user トリガーが既に insert する場合に備え upsert する
  const { error: profileError } = await admin
    .from('user_profiles')
    .upsert({ id: userId, email, role: opts.role }, { onConflict: 'id' });
  if (profileError) {
    // ロールバック: Auth ユーザーを削除してから例外を投げる
    await admin.auth.admin.deleteUser(userId);
    throw new Error(`テストユーザー(user_profiles)の作成に失敗: ${profileError.message}`);
  }

  // ── 3. user_schools に教室紐づけを insert
  if (opts.schoolIds && opts.schoolIds.length > 0) {
    const { error: schoolsError } = await admin
      .from('user_schools')
      .insert(opts.schoolIds.map((sid) => ({ user_id: userId, school_id: sid })));
    if (schoolsError) {
      await admin.auth.admin.deleteUser(userId);
      throw new Error(`テストユーザー(user_schools)の紐づけに失敗: ${schoolsError.message}`);
    }
  }

  return { userId, email, password };
}

/**
 * メール・パスワードでサインインし、認証済みクライアントを返す。
 *
 * 返却したクライアントで実行したクエリは DB 上で:
 *   - ロール: "authenticated"
 *   - auth.uid(): サインインしたユーザーのUUID
 * として扱われ、RLS ポリシーが有効になる。
 *
 * @param email    ユーザーのメールアドレス
 * @param password パスワード
 */
export async function signInAsUser(email: string, password: string): Promise<SupabaseClient> {
  // まず匿名クライアントでサインイン
  const anonClient = getAnonClient();
  const { data, error } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(`サインインに失敗: ${error?.message}`);
  }

  const accessToken = data.session.access_token;

  // アクセストークンを Authorization ヘッダに付けた新しいクライアントを返す
  // anon キーを使いつつヘッダでトークンを注入することで
  // "authenticated" ロールとして RLS が評価される
  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: { persistSession: false },
  });
}

/**
 * テストユーザーを削除する。
 * user_schools → user_profiles の順に削除してから Auth ユーザーを削除する。
 *
 * @param admin   service_role クライアント
 * @param userId  削除するユーザーのUUID
 */
export async function cleanupTestUser(admin: SupabaseClient, userId: string): Promise<void> {
  // 外部キー順: user_schools → user_profiles → Auth
  await admin.from('user_schools').delete().eq('user_id', userId);
  await admin.from('user_profiles').delete().eq('id', userId);
  await admin.auth.admin.deleteUser(userId);
}
