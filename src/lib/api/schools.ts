import { supabase } from '@/lib/supabase';
import type { School } from '@/types/database';

// デフォルト教室IDを取得（環境変数から）
export function getDefaultSchoolId(): string {
  const schoolId = process.env.NEXT_PUBLIC_DEFAULT_SCHOOL_ID;
  if (!schoolId) {
    const errorMessage = [
      'NEXT_PUBLIC_DEFAULT_SCHOOL_ID が設定されていません。',
      '',
      '設定手順:',
      '1. SupabaseのSQL Editorで supabase/schema.sql を実行してください',
      '2. 以下のSQLでデフォルト教室のIDを取得してください:',
      '   SELECT id FROM schools WHERE code = \'DEFAULT\';',
      '3. .env.local に以下を追加してください:',
      '   NEXT_PUBLIC_DEFAULT_SCHOOL_ID=取得したUUID',
      '4. 開発サーバーを再起動してください',
    ].join('\n');
    throw new Error(errorMessage);
  }
  return schoolId;
}

// 教室を1件取得
export async function getSchool(id: string): Promise<School | null> {
  const { data, error } = await supabase
    .from('schools')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Error fetching school:', error);
    throw new Error('教室情報の取得に失敗しました');
  }

  return data as School | null;
}

// 教室コードで教室を取得
export async function getSchoolByCode(code: string): Promise<School | null> {
  const { data, error } = await supabase
    .from('schools')
    .select('*')
    .eq('code', code)
    .maybeSingle();

  if (error) {
    console.error('Error fetching school by code:', error);
    throw new Error('教室情報の取得に失敗しました');
  }

  return data as School | null;
}