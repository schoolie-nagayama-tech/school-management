import { getSupabaseBrowserClient } from '@/lib/supabase';
import { fetchWithAuth } from '@/lib/api/auth';

/**
 * 対象ユーザーにアカウントスイッチする（admin 専用）
 * 成功すると対象ユーザーとしてログインされ、トップへ遷移する
 */
export async function impersonateUser(userId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.refresh_token) throw new Error('現在のセッションが取得できません');

  const res = await fetchWithAuth('/api/admin/impersonate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, currentRefreshToken: session.refresh_token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'スイッチに失敗しました');
  }
  const { hashedToken, actionLink } = await res.json();

  // hashed_token があれば verifyOtp でその場でセッション確立（リダイレクト不要 & 確実）
  if (hashedToken) {
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'magiclink',
    });
    if (verifyError) {
      // フォールバック: アクションリンクへ遷移
      if (actionLink) {
        window.location.href = actionLink;
        return;
      }
      throw verifyError;
    }
    // セッションが切り替わったので全ページリロードして AuthContext を再初期化
    window.location.href = '/';
    return;
  }

  // 旧パス: アクションリンクへ遷移
  if (actionLink) {
    window.location.href = actionLink;
    return;
  }
  throw new Error('スイッチ用のトークンが取得できませんでした');
}

/**
 * 元の管理者アカウントに戻る
 */
export async function stopImpersonation(): Promise<void> {
  const res = await fetchWithAuth('/api/admin/impersonate/stop', { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '復元に失敗しました');
  }
  const { refreshToken } = await res.json();
  const supabase = getSupabaseBrowserClient();
  // 保存しておいた refresh_token でセッションを復元
  const { error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw error;
  window.location.href = '/';
}

/**
 * 現在スイッチ中かどうか（非 httpOnly の cookie を見る）
 */
export function isImpersonating(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some((c) => c.startsWith('impersonator_user_id='));
}
