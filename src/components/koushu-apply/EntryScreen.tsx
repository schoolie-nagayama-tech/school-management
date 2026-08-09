'use client';

/**
 * 生徒コード入口（決定19・§10-1）。
 * ポータル経由（/portal/[schoolCode]/koushu）で開いたときに最初に出す本人確認画面。
 * モック `apply-mock` の EntryScreenMock を本実装へ移植。
 *
 * 入力後は同じURLに `?code=` を付けて遷移する。サーバー側（page.tsx）がそのクエリを見て
 * `loadKoushuApplyForm({kind:'studentCode', ...})` を呼ぶ。ここでは解決結果を持たず、
 * ナビゲーションだけを担当する（トークン付きURLから開いた場合はこの画面を経由しない）。
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';

interface EntryScreenProps {
  schoolCode: string;
}

export function EntryScreen({ schoolCode }: EntryScreenProps) {
  const router = useRouter();
  const [code, setCode] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    router.push(`/portal/${schoolCode}/koushu?code=${encodeURIComponent(trimmed)}`);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="h-full flex flex-col justify-center px-6 py-10 space-y-5"
    >
      <div className="text-center space-y-1.5">
        <KeyRound className="w-8 h-8 mx-auto text-[var(--paragraph)]" />
        <h2 className="text-base font-semibold text-[var(--headline)]">生徒コードで開く</h2>
        <p className="text-xs text-[var(--paragraph)]">
          教室から伝えられた生徒コードを入力してください
        </p>
      </div>
      <label className="block text-xs text-[var(--headline)]">
        生徒コード
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="例）A1234"
          className="mt-1 w-full text-sm border border-[var(--stroke)] rounded-lg px-3 py-2.5"
        />
      </label>
      <button
        type="submit"
        disabled={!code.trim()}
        className="w-full py-2.5 rounded-lg bg-ink text-white text-sm font-medium disabled:opacity-40"
      >
        開く
      </button>
      <p className="text-[11px] text-[var(--paragraph)] text-center leading-relaxed">
        教室から配られたQR・リンクから開いた場合、この画面は表示されません。
      </p>
    </form>
  );
}
