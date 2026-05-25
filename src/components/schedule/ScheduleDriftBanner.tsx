'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import {
  detectScheduleDrift,
  generateWeeklySchedule,
  getCurrentWeekStartDateStr,
  type ScheduleDriftWeek,
} from '@/lib/api/schedule';
import { useToast } from '@/hooks/useToast';

interface ScheduleDriftBannerProps {
  schoolId: string;
  userId?: string;
  /** 検査範囲（週数）。デフォルト4週 */
  weeksAhead?: number;
  /** 再生成完了後に呼ばれる（親側の再フェッチ等に） */
  onResynced?: () => void;
}

/**
 * 通塾日程と座席表のズレを検知して警告するバナー
 *
 * - 通塾日程を変更したが座席表に反映されていない（missing）
 * - 座席表に古いパターンのエントリが残っている（extra）
 *
 * 「反映する」ボタンで該当週のスケジュールを再生成する。
 */
export function ScheduleDriftBanner({
  schoolId,
  userId,
  weeksAhead = 4,
  onResynced,
}: ScheduleDriftBannerProps) {
  const [drifts, setDrifts] = useState<ScheduleDriftWeek[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const { success, error: toastError } = useToast();

  const fetchDrifts = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const fromWeek = getCurrentWeekStartDateStr();
      const result = await detectScheduleDrift(schoolId, fromWeek, weeksAhead);
      setDrifts(result);
    } catch (e) {
      console.warn('ズレ検知に失敗:', e);
    } finally {
      setLoading(false);
    }
  }, [schoolId, weeksAhead]);

  useEffect(() => {
    fetchDrifts();
  }, [fetchDrifts]);

  const handleResync = async () => {
    if (drifts.length === 0) return;
    setResyncing(true);
    try {
      for (const d of drifts) {
        await generateWeeklySchedule(schoolId, d.weekStart, userId);
      }
      success(`${drifts.length}週分の座席表を再生成しました`);
      setDrifts([]);
      onResynced?.();
    } catch (e) {
      toastError((e as Error).message);
    } finally {
      setResyncing(false);
    }
  };

  if (loading || dismissed || drifts.length === 0) return null;

  const totalMissing = drifts.reduce((sum, d) => sum + d.missingCount, 0);
  const totalExtra = drifts.reduce((sum, d) => sum + d.extraCount, 0);

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900">
          通塾日程と座席表にズレがあります（{drifts.length}週分）
        </p>
        <p className="text-xs text-amber-800 mt-0.5">
          {totalMissing > 0 && <>未反映 {totalMissing}件 </>}
          {totalExtra > 0 && <>古いエントリ {totalExtra}件</>}
          ：曜日変更・コマ数変更・退塾予定日の編集が、生成済みスケジュールに反映されていない可能性があります。
        </p>
        <ul className="text-[11px] text-amber-700 mt-1 space-y-0.5">
          {drifts.map((d) => (
            <li key={d.weekStart}>
              {d.weekStart} の週：未反映 {d.missingCount} / 古い {d.extraCount}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button
          type="button"
          onClick={handleResync}
          disabled={resyncing}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${resyncing ? 'animate-spin' : ''}`} />
          {resyncing ? '反映中...' : '反映する'}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="inline-flex items-center justify-center px-2 py-1 rounded text-xs text-amber-700 hover:bg-amber-100"
          aria-label="閉じる"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
