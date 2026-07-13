'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePrivacyScreenSettings } from './usePrivacyScreenSettings';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;

// 最終操作時刻をタブ間で共有する localStorage キー。これを正典にすることで
// 「操作は全タブ共通」「あるタブでクリック解除したら全タブで解除」を実現する。
// （無操作ログアウト useInactivityLogout と同じ設計思想。用途ごとにキーは分ける）
const STORAGE_KEY = 'privacyScreenLastActivityAt';

// mousemove/scroll 等の高頻度イベントで localStorage を書きすぎないための間引き間隔。
const WRITE_THROTTLE_MS = 2000;

// setTimeout はバックグラウンドタブで間引かれるため、取りこぼし対策のポーリング間隔。
const CHECK_INTERVAL_MS = 4000;

function readLastActivity(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeLastActivity(ts: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(ts));
  } catch {
    // localStorage が使えない環境では、そのタブ内のタイマーのみで動作する。
  }
}

/**
 * プライバシースクリーンの表示制御フック
 * - ロール別タイムアウトのうち、現在ロールの値が 0 より大きい場合のみ有効
 * - 指定時間無操作でオーバーレイ表示
 * - クリックで解除
 *
 * 表示状態はタブ間で共通。最終操作時刻を localStorage で共有し、
 * どれかのタブで解除（クリック）or 操作があれば全タブに伝播する。
 * これにより複数タブを開いていても、タブを切り替えるたびに再クリックする必要がない。
 */
export function usePrivacyScreen() {
  const { profile } = useAuth();
  const { timeoutByRole, isLoading } = usePrivacyScreenSettings();
  const [showOverlay, setShowOverlay] = useState(false);

  const roleTimeout = profile?.role ? (timeoutByRole[profile.role] ?? 0) : 0;
  const timeoutMs = roleTimeout * 1000;

  // ロック中かどうかをイベントハンドラから参照するための ref（effect の再購読を避ける）。
  const lockedRef = useRef(false);
  lockedRef.current = showOverlay;

  // 無操作判定タイマー。effect からも dismiss からも参照する。
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 再スケジュール関数を dismiss（effect 外）から呼べるように ref で公開する。
  const scheduleRef = useRef<(() => void) | null>(null);

  // クリック解除。全タブへ伝播させるため localStorage に「今」を書く
  // （他タブは storage イベントで解除する）。書き込みは自タブの storage イベントを
  // 発火しないので、自タブは即座に state を落として再スケジュールする。
  const dismiss = useCallback(() => {
    if (timeoutMs <= 0) return;
    writeLastActivity(Date.now());
    lockedRef.current = false;
    setShowOverlay(false);
    scheduleRef.current?.();
  }, [timeoutMs]);

  useEffect(() => {
    if (isLoading || !profile?.role || timeoutMs <= 0) return;
    if (typeof window === 'undefined') return;

    // 既存の共有値があれば尊重し、無いときだけ現在時刻で初期化する。
    // ロック中の別タブがあるのに新規タブが勝手に解除してしまうのを防ぐ（フェイルセキュア）。
    if (readLastActivity() <= 0) writeLastActivity(Date.now());

    // throttle 用の直近書き込み時刻。
    let lastWrite = 0;

    const lock = () => {
      lockedRef.current = true;
      setShowOverlay(true);
    };

    const unlock = () => {
      lockedRef.current = false;
      setShowOverlay(false);
    };

    const scheduleCheck = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const remaining = readLastActivity() + timeoutMs - Date.now();
      timerRef.current = setTimeout(evaluate, Math.max(0, remaining));
    };
    scheduleRef.current = scheduleCheck;

    // 共有の最終操作時刻から、ロックすべきか判定する。ポーリング・タイマー・
    // タブ復帰の共通判定。操作が別タブで更新されていれば解除にも使う。
    const evaluate = () => {
      timerRef.current = null;
      const idle = Date.now() - readLastActivity();
      if (idle >= timeoutMs) {
        lock();
      } else {
        if (lockedRef.current) unlock();
        scheduleCheck();
      }
    };

    // 操作イベント: ロック中は無視（クリック解除以外で勝手に解けないように）。
    // 非ロック中は間引いて最終操作時刻を更新し、タイマーを引き直す。
    const handleActivity = () => {
      if (lockedRef.current) return;
      const t = Date.now();
      if (t - lastWrite >= WRITE_THROTTLE_MS) {
        lastWrite = t;
        writeLastActivity(t);
        scheduleCheck();
      }
    };

    // 別タブが最終操作時刻を更新したとき（操作・クリック解除の両方）に同期する。
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      evaluate();
    };

    // タブ復帰時は即判定（バックグラウンドで間引かれたタイマーの取りこぼし対策）。
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') evaluate();
    };

    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, handleActivity, { passive: true }));
    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', handleVisibility);
    const intervalId = window.setInterval(evaluate, CHECK_INTERVAL_MS);

    scheduleCheck();

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, handleActivity));
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(intervalId);
      scheduleRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, profile?.role, timeoutMs]);

  const isActive = !isLoading && !!profile?.role && roleTimeout > 0;

  return {
    showOverlay: isActive && showOverlay,
    dismiss,
    isActive,
  };
}
