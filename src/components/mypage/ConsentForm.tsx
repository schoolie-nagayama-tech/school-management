'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { Check } from 'lucide-react';

interface ConsentFormProps {
  /** 表示・リンクする文書（プライバシーポリシー・利用規約）。 */
  documents: Array<{ title: string; href: string; version: string }>;
}

/**
 * 再同意フォーム。同意して /api/mypage/consent に記録したらマイページへ戻る。
 *
 * ★ 「あとで」を置かない:
 *   版が上がった文書は、同意を取り直すまで利用を続けさせない前提の画面
 *   （利用規約 第13条3項「重要な影響のある変更は次回ログイン時にあらためて同意」）。
 *   スキップ導線を作ると、ダッシュボード側のリダイレクトと矛盾して無限に戻される。
 */
export function ConsentForm({ documents }: ConsentFormProps) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/mypage/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agreed }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? '同意の記録に失敗しました');
        return;
      }
      router.push('/mypage');
      // 記録直後にダッシュボードを取り直さないと、サーバー側の判定が古いままで
      // またこの画面へ戻されてしまう。
      router.refresh();
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <ul className="mb-5 space-y-2">
        {documents.map((doc) => (
          <li key={doc.href}>
            <a
              href={doc.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-info underline underline-offset-2"
            >
              {doc.title}
            </a>
            <span className="ml-2 text-xs text-text-muted">{doc.version}</span>
          </li>
        ))}
      </ul>

      <label className="mb-4 flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-info focus:ring-2 focus:ring-primary"
        />
        <span className="text-sm leading-relaxed text-text-body">
          上記の内容を確認し、同意します
        </span>
      </label>

      {error && (
        <div className="mb-4 rounded-lg border border-danger bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      <Button onClick={submit} isLoading={submitting} disabled={!agreed} className="w-full">
        <Check className="mr-2 h-4 w-4" />
        同意して続ける
      </Button>
    </div>
  );
}
