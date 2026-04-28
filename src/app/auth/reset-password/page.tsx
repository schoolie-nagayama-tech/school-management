'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updatePassword } from '@/lib/api/auth';
import { Check } from 'lucide-react';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('パスワードは8文字以上で入力してください');
      return;
    }

    if (password !== confirmPassword) {
      setError('パスワードが一致しません');
      return;
    }

    setIsLoading(true);

    try {
      await updatePassword(password);
      setIsSuccess(true);
      setTimeout(() => {
        router.push('/login');
      }, 3000);
    } catch (err: any) {
      console.error('Password update error:', err);
      setError('パスワードの更新に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#1f2937]">新しいパスワード設定</h1>
          <p className="text-[#4b5563] mt-2">新しいパスワードを入力してください</p>
        </div>

        <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 shadow-lg">
          {isSuccess ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-[#1f2937] mb-2">パスワードを更新しました</h2>
              <p className="text-[#4b5563]">
                3秒後にログイン画面に移動します...
              </p>
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
                    新しいパスワード
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full px-4 py-3 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                    placeholder="8文字以上"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1f2937] mb-1">
                    パスワード（確認）
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                    placeholder="もう一度入力"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 bg-[#3b82f6] text-white font-bold rounded-lg hover:bg-[#60a5fa] transition-colors disabled:opacity-50"
                >
                  {isLoading ? '更新中...' : 'パスワードを更新'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
