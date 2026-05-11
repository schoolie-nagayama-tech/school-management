'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getInvitationByToken, signUpWithEmail } from '@/lib/api/auth';
import { X } from 'lucide-react';
import type { UserInvitation } from '@/types/database';
import { USER_ROLE_LABELS } from '@/types/database';

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;
  
  const [invitation, setInvitation] = useState<UserInvitation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (token) {
      loadInvitation();
    }
  }, [token]);

  const loadInvitation = async () => {
    try {
      const inv = await getInvitationByToken(token);
      if (!inv) {
        setError('招待が見つからないか、有効期限が切れています');
      } else {
        setInvitation(inv);
      }
    } catch (err) {
      console.error('Error loading invitation:', err);
      setError('招待情報の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitation) return;

    setError('');

    if (password.length < 8) {
      setError('パスワードは8文字以上で入力してください');
      return;
    }

    if (password !== confirmPassword) {
      setError('パスワードが一致しません');
      return;
    }

    setIsSubmitting(true);

    try {
      // アカウント作成
      const { user } = await signUpWithEmail(invitation.email, password);

      if (user) {
        // プロファイル・教室紐付け・招待承諾をサーバー側で実行（RLSを避けユーザー管理に表示されるようにする）
        const res = await fetch('/api/invite/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            displayName: displayName || undefined,
            userId: user.id,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || '招待の完了に失敗しました');
        }

        router.push('/students');
      }
    } catch (err: unknown) {
      console.error('Error accepting invitation:', err);
      const message = err instanceof Error ? err.message : '';
      if (message.includes('already registered') || message.includes('User already registered')) {
        setError('このメールアドレスは既に登録されています');
      } else {
        setError('アカウントの作成に失敗しました');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-[#4b5563]">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl border border-[#e5e7eb] p-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-[#ef4444]/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <X className="w-8 h-8 text-[#ef4444]" />
            </div>
            <h2 className="text-xl font-bold text-[#1f2937] mb-2">招待が無効です</h2>
            <p className="text-[#4b5563] mb-6">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#1f2937]">アカウント作成</h1>
          <p className="text-[#4b5563] mt-2">生徒管理システムへようこそ</p>
        </div>

        <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 shadow-lg">
          {invitation && (
            <>
              <div className="mb-6 p-4 bg-[#3b82f6]/10 rounded-lg">
                <p className="text-sm text-[#1f2937]">
                  <span className="font-bold">{invitation.email}</span> として<br />
                  <span className="font-bold">{USER_ROLE_LABELS[invitation.role]}</span> 権限で招待されています
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-[#ef4444]/10 border border-[#ef4444] rounded-lg">
                  <p className="text-sm text-[#ef4444]">{error}</p>
                </div>
              )}

              <form onSubmit={handleAccept} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#1f2937] mb-1">
                    表示名（任意）
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    className="w-full px-4 py-3 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                    placeholder="山田太郎"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1f2937] mb-1">
                    パスワード
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
                  disabled={isSubmitting}
                  className="w-full py-3 bg-[#3b82f6] text-white font-bold rounded-lg hover:bg-[#60a5fa] transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'アカウント作成中...' : 'アカウントを作成'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
