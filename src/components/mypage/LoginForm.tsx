'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/components/ui';
import { LogIn } from 'lucide-react';

/**
 * 保護者ポータル ログインフォーム（ID/PW）。
 * login_id / パスワードを /api/mypage/login に送り、成功で /mypage へ。
 * モバイルファースト・装飾絵文字なし（アイコンは lucide-react）。
 *
 * LINEログインは別導線（LineLoginButton＝リンク）なのでこのフォームには含めない。
 */
export function LoginForm() {
  const router = useRouter();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/mypage/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_id: loginId, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'ログインに失敗しました');
        return;
      }
      // 成功: マイページへ。router.refresh でサーバー側のセッション読み取りを反映。
      router.push('/mypage');
      router.refresh();
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
        autoComplete="current-password"
        required
      />

      {error && (
        <div className="rounded-lg border border-danger bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <Button type="submit" isLoading={submitting} className="w-full">
        <LogIn className="mr-2 h-4 w-4" />
        ログイン
      </Button>
    </form>
  );
}
