'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getInvitationByToken, signUpWithEmail } from '@/lib/api/auth';
import { Loading } from '@/components/ui';
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
      <div className="min-h-screen bg-surface-hover flex items-center justify-center">
        <Loading />
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="min-h-screen bg-surface-hover flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-surface-raised rounded-xl border border-border p-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-danger/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <X className="w-8 h-8 text-danger" />
            </div>
            <h2 className="text-xl font-bold text-text-heading mb-2">招待が無効です</h2>
            <p className="text-text-body mb-6">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-hover flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-text-heading">アカウント作成</h1>
          <p className="text-text-body mt-2">生徒管理システムへようこそ</p>
        </div>

        <div className="bg-surface-raised rounded-xl border border-border p-8 shadow-lg">
          {invitation && (
            <>
              <div className="mb-6 p-4 bg-info/10 rounded-lg">
                <p className="text-sm text-text-heading">
                  <span className="font-bold">{invitation.email}</span> として
                  <br />
                  <span className="font-bold">{USER_ROLE_LABELS[invitation.role]}</span>{' '}
                  権限で招待されています
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-danger/10 border border-danger rounded-lg">
                  <p className="text-sm text-danger">{error}</p>
                </div>
              )}

              <form onSubmit={handleAccept} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-heading mb-1">
                    表示名（任意）
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="山田太郎"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-heading mb-1">
                    パスワード
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full px-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="8文字以上"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-heading mb-1">
                    パスワード（確認）
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="もう一度入力"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 bg-info text-white font-bold rounded-lg hover:bg-info/80 active:scale-[0.97] transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50"
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
