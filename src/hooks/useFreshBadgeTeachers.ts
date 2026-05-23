'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * 「今日 新しいバッジを獲得した」講師ID集合を返す。
 * モジュールレベルでキャッシュし、複数コンポーネント／ページから安全に呼べる。
 * バッジ付与直後に反映したい場合は invalidateFreshBadgeTeachers() を呼ぶ。
 */

let cached: Set<string> | null = null;
let inflight: Promise<Set<string>> | null = null;
const subscribers = new Set<(s: Set<string>) => void>();

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function fetchOnce(): Promise<Set<string>> {
  if (cached !== null) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await supabase
        .from('teacher_badge_assignments')
        .select('teacher_id')
        .gte('created_at', startOfTodayIso());
      const set = new Set<string>((data ?? []).map((r: { teacher_id: string }) => r.teacher_id));
      cached = set;
      subscribers.forEach((cb) => cb(set));
      return set;
    } catch {
      cached = new Set<string>();
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function invalidateFreshBadgeTeachers() {
  cached = null;
  inflight = null;
  // 既に購読者がいれば即座に再取得して通知
  if (subscribers.size > 0) {
    fetchOnce();
  }
}

export function useFreshBadgeTeachers(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(cached ?? new Set<string>());

  useEffect(() => {
    let cancelled = false;
    fetchOnce().then((s) => {
      if (!cancelled) setIds(s);
    });
    subscribers.add(setIds);
    return () => {
      cancelled = true;
      subscribers.delete(setIds);
    };
  }, []);

  return ids;
}
