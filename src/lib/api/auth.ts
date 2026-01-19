import { createSupabaseBrowserClient } from '@/lib/supabase';
import type { UserProfile, UserSchool, UserInvitation, UserWithDetails, UserRole } from '@/types/database';

// =====================================================
// 認証
// =====================================================

// メール+パスワードでサインアップ
export async function signUpWithEmail(email: string, password: string) {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

// メール+パスワードでログイン
export async function signInWithEmail(email: string, password: string) {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

// Googleでログイン
export async function signInWithGoogle() {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) throw error;
  return data;
}

// ログアウト
export async function signOut() {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// パスワードリセットメール送信
export async function sendPasswordResetEmail(email: string) {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/reset-password`,
  });
  if (error) throw error;
  return data;
}

// パスワード更新
export async function updatePassword(newPassword: string) {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (error) throw error;
  return data;
}

// 現在のセッションを取得
export async function getSession() {
  const supabase = createSupabaseBrowserClient();
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  } catch (err: any) {
    // AbortErrorは再スローしない（コンポーネントがアンマウントされた場合）
    if (err?.name === 'AbortError' || err?.message?.includes('aborted') || err?.message?.includes('signal is aborted')) {
      return null;
    }
    throw err;
  }
}

// 現在のユーザーを取得
export async function getCurrentUser() {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

// =====================================================
// ユーザープロファイル
// =====================================================

// プロファイルを取得
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const supabase = createSupabaseBrowserClient();
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data;
  } catch (err: any) {
    // AbortErrorは無視
    if (err?.name === 'AbortError' || err?.message?.includes('aborted') || err?.message?.includes('signal is aborted')) {
      return null;
    }
    throw err;
  }
}

// プロファイルを作成
export async function createUserProfile(
  userId: string,
  email: string,
  role: UserRole,
  displayName?: string,
  invitedBy?: string
): Promise<UserProfile> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .insert({
      id: userId,
      email,
      role,
      display_name: displayName || null,
      invited_by: invitedBy || null,
      invited_at: invitedBy ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// プロファイルを更新
export async function updateUserProfile(
  userId: string,
  updates: Partial<Pick<UserProfile, 'display_name' | 'role' | 'is_active'>>
): Promise<UserProfile> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// 最終ログイン日時を更新
export async function updateLastLogin(userId: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  await supabase
    .from('user_profiles')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', userId);
}

// ユーザー一覧を取得（管理者用）
export async function getUsers(): Promise<UserWithDetails[]> {
  const supabase = createSupabaseBrowserClient();
  
  // まずユーザープロファイルを取得
  const { data: profiles, error: profilesError } = await supabase
    .from('user_profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (profilesError) {
    console.error('Error fetching user profiles:', profilesError);
    throw profilesError;
  }

  if (!profiles || profiles.length === 0) {
    return [];
  }

  // 各ユーザーの教室情報を取得
  const usersWithSchools = await Promise.all(
    profiles.map(async (profile) => {
      const { data: userSchools, error: schoolsError } = await supabase
        .from('user_schools')
        .select(`
          *,
          school:schools(*)
        `)
        .eq('user_id', profile.id);

      if (schoolsError) {
        console.error(`Error fetching schools for user ${profile.id}:`, schoolsError);
        return {
          ...profile,
          schools: [],
        } as UserWithDetails;
      }

      return {
        ...profile,
        schools: (userSchools || []) as any[],
      } as UserWithDetails;
    })
  );

  return usersWithSchools;
}

// =====================================================
// ユーザーと教室の紐付け
// =====================================================

// ユーザーの教室を取得
export async function getUserSchools(userId: string): Promise<UserSchool[]> {
  const supabase = createSupabaseBrowserClient();
  try {
    const { data, error } = await supabase
      .from('user_schools')
      .select('*, school:schools(*)')
      .eq('user_id', userId);

    if (error) throw error;
    return data || [];
  } catch (err: any) {
    // AbortErrorは無視
    if (err?.name === 'AbortError' || err?.message?.includes('aborted') || err?.message?.includes('signal is aborted')) {
      return [];
    }
    throw err;
  }
}

// ユーザーを教室に紐付け
export async function addUserToSchool(userId: string, schoolId: string): Promise<UserSchool> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('user_schools')
    .insert({ user_id: userId, school_id: schoolId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ユーザーを教室から削除
export async function removeUserFromSchool(userId: string, schoolId: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase
    .from('user_schools')
    .delete()
    .eq('user_id', userId)
    .eq('school_id', schoolId);

  if (error) throw error;
}

// =====================================================
// 招待
// =====================================================

// 招待トークンを生成
function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// 招待を作成
export async function createInvitation(
  email: string,
  role: UserRole,
  schoolIds: string[],
  invitedBy: string
): Promise<UserInvitation> {
  const supabase = createSupabaseBrowserClient();
  const token = generateToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7日間有効

  const { data, error } = await supabase
    .from('user_invitations')
    .insert({
      email,
      role,
      school_ids: schoolIds,
      token,
      invited_by: invitedBy,
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// 招待をトークンで取得
export async function getInvitationByToken(token: string): Promise<UserInvitation | null> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('user_invitations')
    .select('*')
    .eq('token', token)
    .is('accepted_at', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  // 有効期限チェック
  if (new Date(data.expires_at) < new Date()) {
    return null;
  }

  return data;
}

// 招待を承諾
export async function acceptInvitation(token: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase
    .from('user_invitations')
    .update({ accepted_at: new Date().toISOString() })
    .eq('token', token);

  if (error) throw error;
}

// 招待一覧を取得
export async function getInvitations(): Promise<UserInvitation[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('user_invitations')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// 招待を削除
export async function deleteInvitation(id: string): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase
    .from('user_invitations')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
