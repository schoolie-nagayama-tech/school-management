import { createSupabaseBrowserClient } from '@/lib/supabase';
import type { UserProfile, UserSchool, UserInvitation, UserWithDetails, UserRole } from '@/types/database';
import { normalizeLoginEmail, normalizePassword } from '@/lib/utils/loginId';

// =====================================================
// 認証
// =====================================================

// メール+パスワードでサインアップ
export async function signUpWithEmail(email: string, password: string) {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.signUp({
    email: normalizeLoginEmail(email),
    password: normalizePassword(password),
  });
  if (error) throw error;
  return data;
}

// ログインがハングしたと判断するまでの待ち時間（ミリ秒）
// Supabase/ネットワークが無応答のとき、ボタンが「ログイン中...」のまま固まるのを防ぐ
export const LOGIN_TIMEOUT_MS = 15000;

// タイムアウト時に投げるエラー。呼び出し側でコード判定できるよう code を持たせる
export class LoginTimeoutError extends Error {
  code = 'LOGIN_TIMEOUT';
  constructor(public timeoutMs: number) {
    super(`ログイン要求が${timeoutMs / 1000}秒以内に完了しませんでした`);
    this.name = 'LoginTimeoutError';
  }
}

// メール+パスワードでログイン
// `@` を含まない入力は内部ドメインを付加（既存システムのIDをそのまま使えるように）
// 短いパスワードは内部的に 6 文字にパディング（Supabase の最低6文字制約を透過的に回避）
export async function signInWithEmail(email: string, password: string) {
  const supabase = createSupabaseBrowserClient();

  // signInWithPassword はタイムアウトを持たないため、Promise.race で上限を設ける
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new LoginTimeoutError(LOGIN_TIMEOUT_MS)),
      LOGIN_TIMEOUT_MS
    );
  });

  try {
    const { data, error } = await Promise.race([
      supabase.auth.signInWithPassword({
        email: normalizeLoginEmail(email),
        password: normalizePassword(password),
      }),
      timeout,
    ]);
    if (error) throw error;
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
}

// パスワードリセットメール送信
export async function sendPasswordResetEmail(email: string) {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.auth.resetPasswordForEmail(
    normalizeLoginEmail(email),
    {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    }
  );
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
  } catch (err: unknown) {
    // AbortErrorは再スローしない（コンポーネントがアンマウントされた場合）
    const errObj = err instanceof Error ? err : null;
    if (errObj?.name === 'AbortError' || errObj?.message?.includes('aborted') || errObj?.message?.includes('signal is aborted')) {
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

/**
 * 認証付きで fetch。API Route が Cookie でセッションを読めない場合のフォールバックとして
 * Authorization: Bearer ヘッダーを付与する。
 */
export async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const session = await getSession();
  const headers = new Headers(options.headers);
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  return fetch(url, { ...options, headers, cache: 'no-store', credentials: 'same-origin' });
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
    return data as UserProfile;
  } catch (err: unknown) {
    // AbortErrorは無視
    const errObj = err instanceof Error ? err : null;
    if (errObj?.name === 'AbortError' || errObj?.message?.includes('aborted') || errObj?.message?.includes('signal is aborted')) {
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
  invitedBy?: string,
  lastName?: string,
  firstName?: string,
): Promise<UserProfile> {
  const supabase = createSupabaseBrowserClient();
  // 姓名が渡された場合は display_name を自動生成
  const effectiveDisplayName = lastName
    ? [lastName, firstName].filter(Boolean).join(' ')
    : (displayName || null);
  const { data, error } = await supabase
    .from('user_profiles')
    .insert({
      id: userId,
      email,
      role,
      display_name: effectiveDisplayName,
      last_name: lastName || null,
      first_name: firstName || null,
      invited_by: invitedBy || null,
      invited_at: invitedBy ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as UserProfile;
}

// プロファイルを更新
export async function updateUserProfile(
  userId: string,
  updates: Partial<Pick<UserProfile, 'display_name' | 'last_name' | 'first_name' | 'role' | 'is_active' | 'teachable_subject_ids' | 'available_days_of_week' | 'default_school_id'>>
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
  return data as UserProfile;
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

  // 全ユーザーの教室情報を一括取得（N+1クエリ解消）
  const allUserIds = (profiles as UserProfile[]).map((p) => p.id);
  const { data: allUserSchools, error: schoolsError } = await supabase
    .from('user_schools')
    .select(`
      *,
      school:schools(*)
    `)
    .in('user_id', allUserIds);

  if (schoolsError) {
    console.error('Error fetching user schools:', schoolsError);
  }

  // ユーザーIDごとに教室情報をグループ化
  const schoolsByUserId = new Map<string, Record<string, unknown>[]>();
  for (const us of (allUserSchools || []) as Array<Record<string, unknown>>) {
    const userId = us.user_id as string;
    const list = schoolsByUserId.get(userId) || [];
    list.push(us);
    schoolsByUserId.set(userId, list);
  }

  const usersWithSchools = (profiles as UserProfile[]).map((profile) => ({
    ...profile,
    schools: schoolsByUserId.get(profile.id) || [],
  } as unknown as UserWithDetails));

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
  } catch (err: unknown) {
    // AbortErrorは無視
    const errObj = err instanceof Error ? err : null;
    if (errObj?.name === 'AbortError' || errObj?.message?.includes('aborted') || errObj?.message?.includes('signal is aborted')) {
      return [];
    }
    throw err;
  }
}

// ユーザーを教室に紐付け（既に紐づいている場合はスキップして 409 を防ぐ）
export async function addUserToSchool(userId: string, schoolId: string): Promise<UserSchool | null> {
  const supabase = createSupabaseBrowserClient();

  const { data: existing } = await supabase
    .from('user_schools')
    .select('*')
    .eq('user_id', userId)
    .eq('school_id', schoolId)
    .maybeSingle();

  if (existing) return existing as UserSchool;

  const { data, error } = await supabase
    .from('user_schools')
    .insert({ user_id: userId, school_id: schoolId })
    .select()
    .single();

  if (error) throw error;
  return data as UserSchool;
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
  return data as UserInvitation;
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
  if (new Date((data as UserInvitation).expires_at) < new Date()) {
    return null;
  }

  return data as UserInvitation;
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
  return (data || []) as UserInvitation[];
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
