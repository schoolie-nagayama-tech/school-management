'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { UserPlus, Link2 } from 'lucide-react';
import { LineLoginButton } from './LineLoginButton';

interface InviteAcceptProps {
  token: string;
  /** 'guardian' | 'student' */
  inviteType: string;
  studentName: string;
  /** 既に有効なポータルセッションがあるか（あれば紐づけ確認モード）。 */
  hasSession: boolean;
  /** LINEログインが設定済みか（未設定環境ではボタンを出さない）。 */
  lineEnabled?: boolean;
}

const RELATION_OPTIONS = [
  { value: 'father', label: '父' },
  { value: 'mother', label: '母' },
  { value: 'other', label: 'その他' },
];

/**
 * 招待受諾フォーム。2モード:
 *  - hasSession: 現アカウントに「この生徒を紐づける」確認ボタンのみ。
 *  - 未ログイン: LINEではじめる／IDとパスワードで登録、の2択。
 *
 * ★ LINE経路が「登録」ではなく「ログイン」に見えるのは意図的:
 *   LINEを押すと /api/mypage/line/start へ飛び、コールバックでアカウントが作られた
 *   （または既存アカウントでログインした）状態でこのページに戻ってくる。
 *   戻ったときは hasSession=true になるので、そこで続柄を選んで紐づけを完了する。
 *   続柄をLINE往復の前に選ばせても保持できないため、往復後に聞く作りにしている。
 */
export function InviteAccept({
  token,
  inviteType,
  studentName,
  hasSession,
  lineEnabled = false,
}: InviteAcceptProps) {
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

      {/* 未ログインのときだけ LINE 経路を出す。押すとLINE往復後にこのページへ戻る。 */}
      {!hasSession && lineEnabled && (
        <>
          <LineLoginButton invite={token} label="LINEではじめる" />
          <p className="mt-2 text-xs text-text-muted">
            LINEではじめると、教室からのお知らせをLINEで受け取れます。
          </p>
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-text-muted">または</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

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
