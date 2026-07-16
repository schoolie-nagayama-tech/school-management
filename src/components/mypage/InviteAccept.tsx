'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { UserPlus, Link2 } from 'lucide-react';

interface InviteAcceptProps {
  token: string;
  /** 'guardian' | 'student' */
  inviteType: string;
  studentName: string;
  /** 既に有効なポータルセッションがあるか（あれば紐づけ確認モード）。 */
  hasSession: boolean;
}

const RELATION_OPTIONS = [
  { value: 'father', label: '父' },
  { value: 'mother', label: '母' },
  { value: 'other', label: 'その他' },
];

/**
 * 招待受諾フォーム。2モード:
 *  - hasSession: 現アカウントに「この生徒を紐づける」確認ボタンのみ。
 *  - 未ログイン: アカウント作成フォーム（保護者招待なら続柄選択つき）。
 */
export function InviteAccept({ token, inviteType, studentName, hasSession }: InviteAcceptProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [relation, setRelation] = useState('father');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isGuardian = inviteType === 'guardian';

  const submit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { token };
      if (!hasSession) {
        body.display_name = displayName;
        body.login_id = loginId;
        body.password = password;
      }
      if (isGuardian) body.relation = relation;

      const res = await fetch('/api/mypage/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? '受諾に失敗しました');
        return;
      }
      // 成功: マイページへ。
      router.push('/mypage');
      router.refresh();
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pt-4">
      <h1 className="mb-1 text-xl font-bold text-text-heading">
        {hasSession ? '生徒の紐づけ' : 'アカウント登録'}
      </h1>
      <p className="mb-4 text-sm text-text-muted">
        <span className="font-medium text-text-heading">{studentName}</span> さん
        {isGuardian ? 'の保護者として' : '本人として'}招待されています。
      </p>

      {isGuardian && (
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-text-heading">続柄</label>
          <div className="flex gap-2">
            {RELATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRelation(opt.value)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  relation === opt.value
                    ? 'border-ink bg-ink/10 font-medium text-text-heading'
                    : 'border-border text-text-muted hover:bg-surface-hover'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!hasSession && (
        <div className="mb-4 space-y-4">
          <Input
            label="表示名"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例: 山田 太郎"
            required
          />
          <Input
            label="ログインID"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            autoComplete="username"
            required
          />
          <Input
            label="パスワード"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            helpText="8文字以上"
            autoComplete="new-password"
            required
          />
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-danger bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <Button onClick={submit} isLoading={submitting} className="w-full">
        {hasSession ? (
          <>
            <Link2 className="mr-2 h-4 w-4" />
            この生徒を紐づける
          </>
        ) : (
          <>
            <UserPlus className="mr-2 h-4 w-4" />
            登録してはじめる
          </>
        )}
      </Button>
    </div>
  );
}
