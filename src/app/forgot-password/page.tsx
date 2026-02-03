'use client';

import { useState } from 'react';
import Link from 'next/link';
import { sendPasswordResetEmail } from '@/lib/api/auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await sendPasswordResetEmail(email);
      setIsSent(true);
    } catch (err: any) {
      console.error('Password reset error:', err);
      setError('パスワードリセットメールの送信に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#1f2937]">パスワードリセット</h1>
          <p className="text-[#4b5563] mt-2">
            登録済みのメールアドレスを入力してください
          </p>
        </div>

        <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 shadow-lg">
          {isSent ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-[#1f2937] mb-2">メールを送信しました</h2>
              <p className="text-[#4b5563] mb-6">
                パスワードリセット用のリンクを<br />
                <span className="font-medium">{email}</span><br />
                に送信しました。メールをご確認ください。
              </p>
              <Link
                href="/login"
                className="inline-block px-6 py-3 bg-[#3b82f6] text-white font-bold rounded-lg hover:bg-[#60a5fa] transition-colors"
              >
                ログイン画面に戻る
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-6 p-4 bg-[#ef4444]/10 border border-[#ef4444] rounded-lg">
                  <p className="text-sm text-[#ef4444]">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#1f2937] mb-1">
                    メールアドレス
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-3 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                    placeholder="example@email.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 bg-[#3b82f6] text-white font-bold rounded-lg hover:bg-[#60a5fa] transition-colors disabled:opacity-50"
                >
                  {isLoading ? '送信中...' : 'リセットメールを送信'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link href="/login" className="text-sm text-[#4b5563] hover:underline">
                  ← ログイン画面に戻る
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
