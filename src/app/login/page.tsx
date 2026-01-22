'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signInWithEmail, signInWithGoogle } from '@/lib/api/auth';

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
    } catch (err: any) {
      setIsLoading(false);
      if (err.message?.includes('Invalid login credentials')) {
        setError('メールアドレスまたはパスワードが正しくありません');
      } else if (err.message?.includes('Email not confirmed')) {
        setError('メールアドレスの確認が完了していません。メールをご確認ください');
      } else {
        setError('ログインに失敗しました');
      }
    }
  };

  // Googleでログイン
  const handleGoogleLogin = async () => {
    setError('');
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError('Googleログインに失敗しました');
    }
  };

  return (
    <div className="min-h-screen bg-[#eff0f3] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* ロゴ・タイトル */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#0d0d0d]">生徒管理システム</h1>
          <p className="text-[#2a2a2a] mt-2">ログイン</p>
        </div>

        {/* ログインフォーム */}
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8 shadow-lg">
          {/* エラー表示 */}
          {error && (
            <div className="mb-6 p-4 bg-[#d9376e]/10 border border-[#d9376e] rounded-lg">
              <p className="text-sm text-[#d9376e] whitespace-pre-line">{error}</p>
            </div>
          )}

          {/* メール+パスワードフォーム */}
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                メールアドレスまたはユーザーID
              </label>
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 border border-[#0d0d0d] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                placeholder="メールアドレスまたはユーザーID"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                パスワード
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 pr-12 border border-[#0d0d0d] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#2a2a2a] hover:text-[#0d0d0d] focus:outline-none"
                  aria-label={showPassword ? 'パスワードを非表示' : 'パスワードを表示'}
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.736m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-[#ff8e3c] text-[#0d0d0d] font-bold rounded-lg hover:bg-[#ff7a1f] transition-colors disabled:opacity-50"
            >
              {isLoading ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>

          {/* 区切り線 */}
          <div className="flex items-center my-6">
            <div className="flex-1 border-t border-[#0d0d0d]/20"></div>
            <span className="px-4 text-sm text-[#2a2a2a]">または</span>
            <div className="flex-1 border-t border-[#0d0d0d]/20"></div>
          </div>

          {/* Googleログイン */}
          <button
            onClick={handleGoogleLogin}
            className="w-full py-3 bg-white border border-[#0d0d0d] rounded-lg hover:bg-[#eff0f3] transition-colors flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
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
            <span className="font-medium text-[#0d0d0d]">Googleでログイン（教室長以上）</span>
          </button>
          <p className="mt-2 text-xs text-[#2a2a2a]/70 text-center">
            ※ 講師の方はメール/パスワードでログインしてください
          </p>

          {/* パスワードリセットリンク */}
          <div className="mt-6 text-center">
            <Link
              href="/forgot-password"
              className="text-sm text-[#ff8e3c] hover:underline"
            >
              パスワードをお忘れですか？
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
