'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { UserRole } from '@/types/database';

export type TimeoutByRole = Partial<Record<UserRole, number>>;

export interface PrivacyScreenSettings {
  timeoutByRole: TimeoutByRole;
  isLoading: boolean;
}

const DEFAULT_TIMEOUT = 60;
const MAX_TIMEOUT = 300;
const ROLES: UserRole[] = ['admin', 'owner', 'manager', 'teacher', 'parent'];

function parseTimeoutByRole(value: string | undefined): TimeoutByRole {
  if (!value) return { owner: DEFAULT_TIMEOUT, manager: DEFAULT_TIMEOUT };
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return { owner: DEFAULT_TIMEOUT, manager: DEFAULT_TIMEOUT };
    const out: TimeoutByRole = {};
    for (const role of ROLES) {
      const v = parsed[role];
      const n = typeof v === 'number' ? v : parseInt(String(v ?? 0), 10);
      out[role] = Number.isNaN(n) ? 0 : Math.max(0, Math.min(MAX_TIMEOUT, n));
    }
    return out;
  } catch {
    return { owner: DEFAULT_TIMEOUT, manager: DEFAULT_TIMEOUT };
  }
}

/**
 * プライバシースクリーンの設定を取得（API経由、キャッシュ付き）
 * 認証済みユーザーのみ API を呼び出す（未ログイン時に 401 を避ける）
 */
export function usePrivacyScreenSettings(): PrivacyScreenSettings {
  const { user, profile, isLoading: authLoading } = useAuth();
  const [timeoutByRole, setTimeoutByRole] = useState<TimeoutByRole>({
    owner: DEFAULT_TIMEOUT,
    manager: DEFAULT_TIMEOUT,
  });
  const [isFetching, setIsFetching] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/system-settings?category=security', {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });
      if (!res.ok) return;

      const json = await res.json();
      const settings = json.settings ?? [];

      let byRole: TimeoutByRole = { owner: DEFAULT_TIMEOUT, manager: DEFAULT_TIMEOUT };
      for (const s of settings) {
        if (s.key === 'privacy_screen_timeout_by_role') {
          byRole = parseTimeoutByRole(s.value);
          break;
        }
      }

      setTimeoutByRole(byRole);
    } catch {
      // サーバー停止・ネットワークエラー時はデフォルト値で静かにフォールバック
    } finally {
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user || !profile) {
      setIsFetching(false);
      return;
    }
    setIsFetching(true);
    fetchSettings();
  }, [authLoading, user, profile, fetchSettings]);

  const isLoading = authLoading || isFetching;

  return { timeoutByRole, isLoading };
}
