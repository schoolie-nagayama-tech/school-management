'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getMyBadges } from '@/lib/api/teacher-badges';

/**
 * 現在ログイン中の講師のバッジ獲得数を取得する。
 * 講師ロール以外では null を返す (取得しない)。
 */
export function useTeacherBadgeCount(): number | null {
  const { profile } = useAuth();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (profile?.role !== 'teacher') {
      setCount(null);
      return;
    }
    let cancelled = false;
    getMyBadges()
      .then(({ assignments }) => {
        if (!cancelled) setCount(assignments.length);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.id, profile?.role]);

  return count;
}
