'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  /**
   * ズレを検知したら手動ボタンを押さずに自動で反映するか。デフォルト true。
   * 通塾日程の変更が多く毎回手動反映するのが手間なため、既定で自動化している。
   * 自動反映が失敗した場合は手動ボタン付きの警告バナーにフォールバックする。
   */
  autoResync?: boolean;
}

/**
 * 通塾日程と座席表のズレを検知して反映するバナー
 *
 * - 通塾日程を変更したが座席表に反映されていない（missing）
 * - 座席表に古いパターンのエントリが残っている（extra）
 *
 * 既定（autoResync=true）ではズレ検知時に該当週を自動で再生成する。
 * 自動反映が失敗したときだけ「反映する」ボタン付きの警告を表示する。
 */
export function ScheduleDriftBanner({
  schoolId,
  userId,
  weeksAhead = 4,
  onResynced,
  autoResync = true,
}: ScheduleDriftBannerProps) {
  const [drifts, setDrifts] = useState<ScheduleDriftWeek[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  // 自動反映が失敗したときだけ true。手動ボタン付きバナーにフォールバックする
  const [autoFailed, setAutoFailed] = useState(false);
  // 同じズレ検知結果に対して自動反映を二重実行しないためのガード
  const autoDoneRef = useRef(false);
  const { success, error: toastError } = useToast();

  const fetchDrifts = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    autoDoneRef.current = false; // 新しい検知結果には改めて自動反映を許可する
    setAutoFailed(false);
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

  const handleResync = useCallback(
    async (auto: boolean) => {
      if (drifts.length === 0) return;
      setResyncing(true);
      try {
        for (const d of drifts) {
          await generateWeeklySchedule(schoolId, d.weekStart, userId);
        }
        success(
          auto
            ? `通塾日程の変更を座席表に自動反映しました（${drifts.length}週分）`
            : `${drifts.length}週分の座席表を再生成しました`
        );
        setDrifts([]);
        onResynced?.();
      } catch (e) {
        toastError((e as Error).message);
        // 自動反映が失敗したら手動ボタン付きバナーへフォールバック
        if (auto) setAutoFailed(true);
      } finally {
        setResyncing(false);
      }
    },
    [drifts, schoolId, userId, success, toastError, onResynced]
  );

  // ズレを検知したら（既定で）一度だけ自動反映する
  useEffect(() => {
    if (!autoResync || autoFailed || dismissed) return;
    if (drifts.length === 0 || resyncing) return;
    if (autoDoneRef.current) return;
    autoDoneRef.current = true;
    void handleResync(true);
  }, [autoResync, autoFailed, dismissed, drifts, resyncing, handleResync]);

  if (loading || dismissed || drifts.length === 0) return null;

  const totalMissing = drifts.reduce((sum, d) => sum + d.missingCount, 0);
  const totalExtra = drifts.reduce((sum, d) => sum + d.extraCount, 0);

  // 自動反映モードで失敗していない間は、控えめな「自動反映中」表示にする（手動操作を促さない）
  if (autoResync && !autoFailed) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-center gap-3">
        <RefreshCw className="w-4 h-4 text-blue-600 shrink-0 animate-spin" />
        <p className="text-sm text-blue-900">
          通塾日程の変更を座席表に自動反映しています（{drifts.length}週分）…
        </p>
      </div>
    );
  }

  // 自動反映に失敗した場合のみ、手動ボタン付きの警告を表示
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900">
          通塾日程と座席表にズレがあります（{drifts.length}週分）
        </p>
        <p className="text-xs text-amber-800 mt-0.5">
          自動反映に失敗しました。{totalMissing > 0 && <>未反映 {totalMissing}件 </>}
          {totalExtra > 0 && <>古いエントリ {totalExtra}件</>}
          ：「反映する」で再生成してください。
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
          onClick={() => handleResync(false)}
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
