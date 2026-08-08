'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * 新しいバージョンの検知バー。
 *
 * PWA/Service Worker がある構成では、デプロイしても端末側は古いバンドルを掴んだままで
 * 「直したはずの画面が変わらない」が起きる（過去に caches.delete + reload でしか直らない
 * 事故があった）。ブラウザが sw.js の更新を見に行くのはナビゲーション時か約24時間ごとなので、
 * PWAを開きっぱなしにしていると何日も古いままになりうる。
 *
 * ここでやること:
 *   1. アプリに戻ってくるたび（focus / visibilitychange）に更新を確認する
 *   2. 新しいSWが waiting になったらバーで知らせる
 *   3. 「更新」を押されたときだけ skipWaiting → reload する
 *
 * 勝手にリロードしない理由: 出勤簿の交通費・備考や面談メモなど入力途中の画面で
 * リロードが走ると打ち込んだ内容が消えるため。更新の主導権はユーザーに渡す。
 */

/** @serwist/next が window.serwist に入れる Serwist(window) のうち、ここで使う部分だけ */
type SerwistWindow = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  messageSkipWaiting(): void;
  update(): Promise<void>;
};

/** 更新確認の最短間隔。フォーカスのたびに投げると無駄なので間引く */
const UPDATE_CHECK_INTERVAL_MS = 60_000;
/** window.serwist が生えるまでの待ち時間（sw-entry の実行タイミングに依存するため） */
const SERWIST_WAIT_TIMEOUT_MS = 10_000;
const SERWIST_POLL_INTERVAL_MS = 300;

function getSerwist(): SerwistWindow | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { serwist?: SerwistWindow }).serwist;
}

export function ServiceWorkerUpdateBar() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  // 「更新」を押して自分で skipWaiting したときだけリロードする。
  // controlling は初回インストール時にも飛ぶので、フラグで区別しないと初訪問で無駄にリロードされる。
  const didRequestUpdate = useRef(false);
  const lastCheckedAt = useRef(0);

  const checkForUpdate = useCallback((serwist: SerwistWindow) => {
    const now = Date.now();
    if (now - lastCheckedAt.current < UPDATE_CHECK_INTERVAL_MS) return;
    lastCheckedAt.current = now;
    // 更新が無ければ何も起きない。失敗（オフライン等）は次の機会に任せる
    void serwist.update().catch(() => {});
  }, []);

  useEffect(() => {
    // 開発環境では SW を無効にしているため window.serwist は生えない
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let cleanup: (() => void) | undefined;

    const attach = (serwist: SerwistWindow) => {
      const onWaiting = () => setHasUpdate(true);
      const onControlling = () => {
        if (!didRequestUpdate.current) return;
        window.location.reload();
      };
      const onFocus = () => checkForUpdate(serwist);
      const onVisibility = () => {
        if (document.visibilityState === 'visible') checkForUpdate(serwist);
      };

      serwist.addEventListener('waiting', onWaiting);
      serwist.addEventListener('controlling', onControlling);
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibility);

      // 初回マウント時にも一度確認する（前回の訪問中にデプロイされているかもしれない）
      checkForUpdate(serwist);

      cleanup = () => {
        serwist.removeEventListener('waiting', onWaiting);
        serwist.removeEventListener('controlling', onControlling);
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisibility);
      };
    };

    const immediate = getSerwist();
    if (immediate) {
      attach(immediate);
    } else {
      // sw-entry がまだ走っていないことがあるので少しだけ待つ
      const startedAt = Date.now();
      pollTimer = setInterval(() => {
        if (cancelled) return;
        const serwist = getSerwist();
        if (serwist) {
          clearInterval(pollTimer);
          attach(serwist);
        } else if (Date.now() - startedAt > SERWIST_WAIT_TIMEOUT_MS) {
          clearInterval(pollTimer);
        }
      }, SERWIST_POLL_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      cleanup?.();
    };
  }, [checkForUpdate]);

  const handleUpdate = () => {
    const serwist = getSerwist();
    if (!serwist) return;
    didRequestUpdate.current = true;
    setIsReloading(true);
    serwist.messageSkipWaiting();
  };

  if (!hasUpdate) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      role="status"
    >
      <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3 shadow-lg">
        <RefreshCw className="h-4 w-4 shrink-0 text-info" />
        <span className="flex-1 text-sm text-text-body">新しいバージョンがあります</span>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={isReloading}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-text-on-primary transition-[transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:opacity-60"
        >
          {isReloading ? '更新中…' : '更新'}
        </button>
      </div>
    </div>
  );
}
