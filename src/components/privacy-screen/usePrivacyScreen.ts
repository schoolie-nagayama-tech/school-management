'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePrivacyScreenSettings } from './usePrivacyScreenSettings';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;

/**
 * プライバシースクリーンの表示制御フック
 * - ロール別タイムアウトのうち、現在ロールの値が 0 より大きい場合のみ有効
 * - 指定時間無操作でオーバーレイ表示
 * - クリックで解除
 */
export function usePrivacyScreen() {
  const { profile } = useAuth();
  const { timeoutByRole, isLoading } = usePrivacyScreenSettings();
  const [showOverlay, setShowOverlay] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const roleTimeout = profile?.role ? (timeoutByRole[profile.role] ?? 0) : 0;

  const resetTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    timerRef.current = setTimeout(() => {
      setShowOverlay(true);
      timerRef.current = null;
    }, roleTimeout * 1000);
  }, [roleTimeout]);

  const dismiss = useCallback(() => {
    setShowOverlay(false);
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    if (isLoading) return;

    if (!profile?.role) return;

    if (roleTimeout <= 0) return;

    resetTimer();

    const handleActivity = () => {
      if (showOverlay) return;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      timerRef.current = setTimeout(() => {
        setShowOverlay(true);
        timerRef.current = null;
      }, roleTimeout * 1000);
    };

    ACTIVITY_EVENTS.forEach((ev) => {
      window.addEventListener(ev, handleActivity);
    });

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => {
        window.removeEventListener(ev, handleActivity);
      });
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isLoading, profile?.role, roleTimeout, resetTimer, showOverlay]);

  const isActive = !isLoading && !!profile?.role && roleTimeout > 0;

  return {
    showOverlay: isActive && showOverlay,
    dismiss,
    isActive,
  };
}
