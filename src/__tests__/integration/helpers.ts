/**
 * 統合テスト用ヘルパー
 * テストデータの作成・クリーンアップを管理する
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env.test') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Service Role クライアント（RLSバイパス）を返す
 */
export function getAdminClient(): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * テスト用教室を作成
 */
export async function createTestSchool(
  client: SupabaseClient,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; name: string; code: string }> {
  const uniqueId = Math.random().toString(36).slice(2, 10);
  const defaults = {
    name: `テスト教室_${uniqueId}`,
    code: `TEST_${uniqueId}`,
    ...overrides,
  };

  const { data, error } = await client
    .from('schools')
    .insert(defaults)
    .select('id, name, code')
    .single();

  if (error) throw new Error(`テスト教室の作成に失敗: ${error.message}`);
  return data;
}

/**
 * テスト用生徒を作成
 */
export async function createTestStudent(
  client: SupabaseClient,
  schoolId: string,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; last_name: string; first_name: string }> {
  const uniqueId = Math.random().toString(36).slice(2, 10);
  const defaults = {
    school_id: schoolId,
    last_name: `姓${uniqueId}`,
    first_name: `名${uniqueId}`,
    grade: 3,
    status: 'active',
    ...overrides,
  };

  const { data, error } = await client
    .from('students')
    .insert(defaults)
    .select('id, last_name, first_name')
    .single();

  if (error) throw new Error(`テスト生徒の作成に失敗: ${error.message}`);
  return data;
}

/**
 * テストデータをクリーンアップ
 * 指定した教室とその関連データ（生徒、ログ等）を削除する
 */
export async function cleanupTestSchool(
  client: SupabaseClient,
  schoolId: string
): Promise<void> {
  // 生徒関連テーブル（CASCADE で連鎖削除されるものが多い）
  // student_logs は student_id FK CASCADE あり
  // students は school_id FK RESTRICT なので先に生徒を削除
  await client.from('student_logs').delete().eq('school_id', schoolId);
  await client.from('students').delete().eq('school_id', schoolId);
  await client.from('schools').delete().eq('id', schoolId);
}
