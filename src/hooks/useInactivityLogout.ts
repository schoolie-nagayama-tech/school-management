'use client';

import { useEffect, useRef } from 'react';
import type { UserRole } from '@/types/database';

/**
 * 無操作（アイドル）ログアウト。
 *
 * 一定時間ユーザー操作が無かった場合に onTimeout（通常はサインアウト）を呼ぶ。
 * 共有端末での覗き見・なりすまし対策（多層防御の一枚）。トークン自体を盗まれた
 * 攻撃を防ぐ硬い境界ではない点に注意（Supabase はデフォルトでトークンを自動
 * リフレッシュし続けるため、この仕組みが無いとセッションは事実上切れない）。
 *
 * タイムアウト値はロール別:
 * - 講師(teacher)/保護者(parent): 60分（教室の共有PCで使う想定が多く短め）
 * - 教室長以上(manager/owner/admin): 2時間（個人占有・長時間作業を想定して長め）
 */

// ロール別タイムアウト（ミリ秒）
const TIMEOUT_BY_ROLE: Record<UserRole, number> = {
  teacher: 60 * 60 * 1000, // 60分
  parent: 60 * 60 * 1000, // 60分
  manager: 2 * 60 * 60 * 1000, // 2時間
  owner: 2 * 60 * 60 * 1000, // 2時間
  admin: 2 * 60 * 60 * 1000, // 2時間
};

// localStorage キー。複数タブ間で最終操作時刻を共有し、片方のタブで操作中に
// もう片方のタブのタイマーが先にログアウトしてしまうのを防ぐ（localStorage を正典にする）。
const STORAGE_KEY = 'inactivityLastActivityAt';

// 操作イベント → localStorage 書き込みの間引き間隔。
// mousemove/scroll 等が高頻度で発火するため、書き込みは最大このペースに抑える。
const WRITE_THROTTLE_MS = 15 * 1000;

// 期限超過を監視するポーリング間隔。実際のログアウトはこの粒度で遅れて発火する。
const CHECK_INTERVAL_MS = 30 * 1000;

// 「操作あり」とみなすイベント。
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'mousemove'] as const;

interface UseInactivityLogoutOptions {
  /** 有効化フラグ。ログイン済みのときだけ true にする。 */
  enabled: boolean;
  /** 現在のユーザーロール。タイムアウト値の決定に使う。 */
  role: UserRole | null | undefined;
  /** タイムアウト到達時に呼ぶコールバック（通常はサインアウト）。 */
  onTimeout: () => void;
}

export function useInactivityLogout({ enabled, role, onTimeout }: UseInactivityLogoutOptions): void {
  // onTimeout は呼び出し側で都度新しい関数になりうるので ref に固定し、
  // effect の再購読（イベントリスナの張り直し）を避ける。
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (!enabled || !role) return;
    if (typeof window === 'undefined') return;

    const timeoutMs = TIMEOUT_BY_ROLE[role];
    if (!timeoutMs) return;

    // 書き込みを間引くための直近書き込み時刻。
    let lastWrite = 0;

    // 最終操作時刻を読む（localStorage を正典にしてタブ間で共有）。
    const readLastActivity = (): number => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? Number(raw) : NaN;
        return Number.isFinite(parsed) ? parsed : 0;
      } catch {
        return 0;
      }
    };

    const writeLastActivity = (ts: number): void => {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(ts));
      } catch {
        // localStorage が使えない環境では無視（その場合はタブ内のポーリングのみで動作）。
      }
    };

    // マウント時に現在時刻で初期化（前回セッションの古い値で即ログアウトされるのを防ぐ）。
    writeLastActivity(Date.now());

    const handleActivity = (): void => {
      const t = Date.now();
      if (t - lastWrite >= WRITE_THROTTLE_MS) {
        lastWrite = t;
        writeLastActivity(t);
      }
    };

    const checkTimeout = (): void => {
      const last = readLastActivity();
      if (last > 0 && Date.now() - last >= timeoutMs) {
        onTimeoutRef.current();
      }
    };

    // タブ復帰時は即チェック。スリープ・別タブ放置はポーリング(setInterval)が
    // バックグラウンドで間引かれて取りこぼすことがあるため、可視化時に必ず判定する。
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        checkTimeout();
      }
    };

    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, handleActivity, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibility);
    const intervalId = window.setInterval(checkTimeout, CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, handleActivity));
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(intervalId);
    };
  }, [enabled, role]);
}
