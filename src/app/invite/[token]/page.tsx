'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getInvitationByToken, acceptInvitation, signUpWithEmail, createUserProfile, addUserToSchool } from '@/lib/api/auth';
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
        // プロファイル作成
        await createUserProfile(
          user.id,
          invitation.email,
          invitation.role,
          displayName || undefined,
          invitation.invited_by || undefined
        );

        // 教室に紐付け
        for (const schoolId of invitation.school_ids) {
          await addUserToSchool(user.id, schoolId);
        }

        // 招待を承諾済みにする
        await acceptInvitation(token);

        router.push('/students');
      }
    } catch (err: any) {
      console.error('Error accepting invitation:', err);
      if (err.message?.includes('already registered') || err.message?.includes('User already registered')) {
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
      <div className="min-h-screen bg-[#eff0f3] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#ff8e3c] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-[#2a2a2a]">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="min-h-screen bg-[#eff0f3] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-[#d9376e]/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#d9376e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-[#0d0d0d] mb-2">招待が無効です</h2>
            <p className="text-[#2a2a2a] mb-6">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eff0f3] flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#0d0d0d]">アカウント作成</h1>
          <p className="text-[#2a2a2a] mt-2">生徒管理システムへようこそ</p>
        </div>

        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8 shadow-lg">
          {invitation && (
            <>
              <div className="mb-6 p-4 bg-[#ff8e3c]/10 rounded-lg">
                <p className="text-sm text-[#0d0d0d]">
                  <span className="font-bold">{invitation.email}</span> として<br />
                  <span className="font-bold">{USER_ROLE_LABELS[invitation.role]}</span> 権限で招待されています
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-[#d9376e]/10 border border-[#d9376e] rounded-lg">
                  <p className="text-sm text-[#d9376e]">{error}</p>
                </div>
              )}

              <form onSubmit={handleAccept} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                    表示名（任意）
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    className="w-full px-4 py-3 border border-[#0d0d0d] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                    placeholder="山田太郎"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                    パスワード
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full px-4 py-3 border border-[#0d0d0d] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                    placeholder="8文字以上"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
                    パスワード（確認）
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 border border-[#0d0d0d] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                    placeholder="もう一度入力"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 bg-[#ff8e3c] text-[#0d0d0d] font-bold rounded-lg hover:bg-[#ff7a1f] transition-colors disabled:opacity-50"
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
