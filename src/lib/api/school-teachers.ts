/**
 * 教室に紐づく講師アカウント (user_profiles role=teacher) を取得するヘルパー。
 * シフト提出のアカウント紐づけUIなどで使う。
 */
import { supabase } from '@/lib/supabase';

export interface SchoolTeacherAccount {
  id: string;
  display_name: string | null;
  email: string | null;
  is_active: boolean;
}

/**
 * 指定教室に user_schools で紐づく role='teacher' の有効アカウントを取得する。
 * display_name 優先で並び替え。
 */
export async function getSchoolTeacherAccounts(schoolId: string): Promise<SchoolTeacherAccount[]> {
  const { data: links, error: linksError } = await supabase
    .from('user_schools')
    .select('user_id')
    .eq('school_id', schoolId);

  if (linksError) {
    throw new Error(`講師アカウントの取得に失敗しました: ${linksError.message}`);
  }

  const userIds = Array.from(
    new Set((links ?? []).map((l: { user_id?: string | null }) => l.user_id).filter((v): v is string => !!v))
  );
  if (userIds.length === 0) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from('user_profiles')
    .select('id, display_name, email, is_active, role')
    .in('id', userIds)
    .eq('role', 'teacher')
    .eq('is_active', true);

  if (profilesError) {
    throw new Error(`講師アカウントの取得に失敗しました: ${profilesError.message}`);
  }

  return ((profiles ?? []) as SchoolTeacherAccount[]).sort((a, b) => {
    const an = a.display_name ?? a.email ?? '';
    const bn = b.display_name ?? b.email ?? '';
    return an.localeCompare(bn, 'ja');
  });
}
