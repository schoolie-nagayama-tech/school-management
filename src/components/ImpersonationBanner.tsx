'use client';

import { useEffect, useState } from 'react';
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
    <div className="fixed top-0 inset-x-0 z-[100] bg-amber-500 text-white text-xs sm:text-sm px-4 py-2 flex items-center justify-center gap-3 shadow-md">
      <span className="font-semibold">⚠ 別アカウントにスイッチ中です</span>
      <button
        onClick={handleStop}
        disabled={busy}
        className="px-3 py-1 bg-white text-amber-700 rounded-md font-medium hover:bg-amber-50 disabled:opacity-50"
      >
        {busy ? '戻り中...' : '元の管理者に戻る'}
      </button>
    </div>
  );
}
