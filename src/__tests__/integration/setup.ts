/**
 * 統合テスト共通セットアップ
 * ローカルSupabaseに接続し、テスト用データを管理する
 */
import { createClient } from '@supabase/supabase-js';
import { beforeAll, afterAll } from 'vitest';
import * as dotenv from 'dotenv';
import path from 'path';

// .env.test から環境変数を読み込み
dotenv.config({ path: path.resolve(__dirname, '../../../.env.test') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// service_role クライアント（RLSバイパス）
export const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// DB接続確認
beforeAll(async () => {
  const { error } = await adminClient.from('schools').select('id').limit(1);
  if (error) {
    throw new Error(
      `ローカルSupabaseに接続できません。\n` +
      `supabase start を実行してから再度テストしてください。\n` +
      `エラー: ${error.message}`
    );
  }
});
