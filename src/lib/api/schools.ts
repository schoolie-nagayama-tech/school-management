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

// 教室一覧を取得
export async function getSchools(): Promise<School[]> {
  const { data, error } = await supabase
    .from('schools')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    console.error('Error fetching schools:', error);
    throw new Error('教室一覧の取得に失敗しました');
  }

  return (data || []) as School[];
}

// 教室を作成
export async function createSchool(data: { name: string; code?: string | null }): Promise<School> {
  const { data: school, error } = await supabase
    .from('schools')
    .insert({
      name: data.name,
      code: data.code || null,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating school:', error);
    if (error.code === '23505') {
      throw new Error('この教室コードは既に使用されています');
    }
    throw new Error('教室の作成に失敗しました');
  }

  return school as School;
}

// 教室を更新
export async function updateSchool(
  id: string,
  data: { name?: string; code?: string | null; notification_email?: string | null }
): Promise<School> {
  const { data: school, error } = await supabase
    .from('schools')
    .update({
      ...data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating school:', error);
    if (error.code === '23505') {
      throw new Error('この教室コードは既に使用されています');
    }
    throw new Error('教室の更新に失敗しました');
  }

  return school as School;
}

// 教室を削除
export async function deleteSchool(id: string): Promise<void> {
  const { error } = await supabase
    .from('schools')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting school:', error);
    throw new Error('教室の削除に失敗しました');
  }
}