'use client';

import { useState, useEffect, useCallback } from 'react';
import { getOverdueSummary } from '@/lib/api/monthlyTasks';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

export function TaskOverdueBanner() {
  const [overdueCount, setOverdueCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchOverdue = useCallback(async () => {
    try {
      const result = await getOverdueSummary();
      setOverdueCount(result.count);
    } catch {
      // エラーは無視（非クリティカル）
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverdue();
  }, [fetchOverdue]);

  if (isLoading || overdueCount === 0) return null;

  return (
    <Link
      href="/tasks"
      className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-[background-color] duration-150 ease-out mb-4"
    >
      <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
      <span className="text-xs font-medium text-red-700">
        期日超過の業務タスクが {overdueCount}件 あります
      </span>
      <span className="text-[11px] text-red-500 ml-auto">確認する →</span>
    </Link>
  );
}
