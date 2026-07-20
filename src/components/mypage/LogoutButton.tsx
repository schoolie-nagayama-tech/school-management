'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

/**
 * ログアウトボタン（保護者ポータル）。
 * /api/mypage/logout を叩いて cookie を消し、ログイン画面へ戻す。
 */
export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleLogout = async () => {
    setBusy(true);
    try {
      await fetch('/api/mypage/logout', { method: 'POST' });
      router.push('/mypage/login');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={busy}
      className="inline-flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-text-heading disabled:opacity-50"
    >
      <LogOut className="h-3.5 w-3.5" />
      ログアウト
    </button>
  );
}
