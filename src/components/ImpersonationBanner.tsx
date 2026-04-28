'use client';

import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { isImpersonating, stopImpersonation } from '@/lib/impersonate';

/**
 * アカウントスイッチ中に画面上部に固定表示されるバナー
 * クリックで元の管理者アカウントに戻れる
 */
export function ImpersonationBanner() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setShow(isImpersonating());
  }, []);

  if (!show) return null;

  const handleStop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stopImpersonation();
    } catch (e) {
      alert((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handleStop}
      disabled={busy}
      title="元の管理者アカウントに戻る"
      className="fixed bottom-6 right-6 z-[100] flex items-center gap-2 px-5 py-3 rounded-full bg-amber-500 hover:bg-amber-600 text-white font-semibold shadow-2xl ring-4 ring-amber-300/40 hover:ring-amber-300/60 disabled:opacity-60 transition-[background-color,box-shadow] duration-150 ease-out text-sm sm:text-base"
    >
      <LogOut className="h-4 w-4" />
      <span className="hidden sm:inline">別アカウントにスイッチ中 —</span>
      <span>{busy ? '戻り中...' : '元の管理者に戻る'}</span>
    </button>
  );
}
