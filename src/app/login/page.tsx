'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signInWithEmail, signInWithGoogle } from '@/lib/api/auth';
import { Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = '/students';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // URLパラメータからエラーを取得
  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam === 'not_registered') {
      setError('このGoogleアカウントは登録されていません。\n管理者にアカウント作成を依頼してください。');
    } else if (errorParam === 'auth_failed') {
      setError('認証に失敗しました。もう一度お試しください。');
    } else if (errorParam === 'not_allowed') {
      setError('Googleログインは教室長以上のアカウントのみ利用可能です。\nメールアドレスとパスワードでログインしてください。');
    }
  }, [searchParams]);

  // メール+パスワードでログイン
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const { user } = await signInWithEmail(email, password);
      if (user) {
        // 認証状態の更新を待ってからリダイレクト
        // AuthContextが認証状態を更新するのを少し待つ
        setTimeout(() => {
          router.push(redirectTo);
        }, 200);
      } else {
        setIsLoading(false);
      }
    } catch (err: unknown) {
      setIsLoading(false);
      const message = err instanceof Error ? err.message : '';
      // Supabase の AuthError はエラーコードと HTTP ステータスを持つので診断用に取り出す
      const errObj = err as { code?: string; status?: number; name?: string } | null;
      const code = errObj?.code;
      const status = errObj?.status;
      // 画面に出す診断情報（コード / HTTPステータス）。原因切り分け用
      const diag = [code && `コード: ${code}`, status && `状態: ${status}`]
        .filter(Boolean)
        .join(' / ');

      if (code === 'LOGIN_TIMEOUT') {
        setError(
          'ログインがタイムアウトしました（15秒以内に応答がありません）。\nネットワーク接続を確認して、もう一度お試しください。'
        );
      } else if (message.includes('Invalid login credentials') || code === 'invalid_credentials') {
        setError('メールアドレスまたはパスワードが正しくありません');
      } else if (message.includes('Email not confirmed') || code === 'email_not_confirmed') {
        setError('メールアドレスの確認が完了していません。メールをご確認ください');
      } else if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
        setError(
          `サーバーに接続できませんでした。ネットワーク接続を確認してください。${diag ? `\n${diag}` : ''}`
        );
      } else {
        setError(`ログインに失敗しました${diag ? `\n${diag}` : `\n詳細: ${message || '不明なエラー'}`}`);
      }
    }
  };

  // Googleでログイン
  const handleGoogleLogin = async () => {
    setError('');
    try {
      await signInWithGoogle();
    } catch {
      setError('Googleログインに失敗しました');
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* ブランドバナー */}
        <div className="bg-primary rounded-2xl px-6 py-6 text-center mb-6 shadow-lg">
          <h1 className="text-3xl font-bold text-white tracking-wide">NEST</h1>
          <p className="text-sm text-white/80 mt-1">生徒管理システム</p>
        </div>

        {/* ログインフォーム */}
        <div className="bg-surface-raised rounded-xl border border-border p-6 shadow-lg space-y-5">
          {/* エラー表示 */}
          {error && (
            <div className="p-3 bg-danger/10 border border-danger/30 rounded-lg">
              <p className="text-sm text-danger whitespace-pre-line">{error}</p>
            </div>
          )}

          {/* ログイン種別の説明 */}
          <div className="rounded-lg bg-surface-hover border border-border-subtle p-3 space-y-1.5">
            <p className="text-xs text-text-body leading-relaxed">
              <span className="font-semibold text-text-heading">教室長以上</span>
              ：メールアドレスでログイン、またはGoogleログイン
            </p>
            <p className="text-xs text-text-body leading-relaxed">
              <span className="font-semibold text-text-heading">講師</span>
              ：ユーザーIDでログイン（Growと同じID・パスワード）
            </p>
          </div>

          {/* メール+パスワードフォーム */}
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-heading mb-1">
                メールアドレス / ユーザーID
              </label>
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                placeholder="メールアドレスまたはユーザーID"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-heading mb-1">
                パスワード
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 pr-10 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-heading focus:outline-none transition-colors"
                  aria-label={showPassword ? 'パスワードを非表示' : 'パスワードを表示'}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-dark active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {isLoading ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>

          {/* 区切り線 */}
          <div className="flex items-center">
            <div className="flex-1 border-t border-border"></div>
            <span className="px-3 text-xs text-text-muted">または</span>
            <div className="flex-1 border-t border-border"></div>
          </div>

          {/* Googleログイン */}
          <button
            onClick={handleGoogleLogin}
            className="w-full py-2.5 bg-white border border-border rounded-lg hover:bg-surface-hover active:scale-[0.98] transition-all flex items-center justify-center gap-2.5"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span className="text-sm font-medium text-text-heading">Googleでログイン</span>
          </button>
          <p className="text-[11px] text-text-muted text-center">
            Googleログインは教室長以上のアカウントのみ
          </p>
        </div>

        {/* パスワードリセットリンク */}
        <div className="mt-4 text-center">
          <Link
            href="/forgot-password"
            className="text-xs text-text-muted hover:text-primary transition-colors"
          >
            パスワードをお忘れですか？
          </Link>
        </div>
      </div>
    </div>
  );
}
