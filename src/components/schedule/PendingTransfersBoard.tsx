'use client';

/**
 * 振替期限切れ間近ボード
 *
 * /schedule トップに表示し、室長に「期限切れ間近 / 期限切れ」の振替を一覧で見せる。
 * クリックすると該当生徒・該当日を絞り込んで座席表に飛ぶ（callback で親に通知）。
 *
 * 表示条件:
 *  - status='transferred_out' かつ transfer_to_id IS NULL（=未消化）
 *  - transfer_deadline <= today + 14 日（=期限14日以内 or 既に期限切れ）
 *
 * 期限切れは赤、7日以内は黄、それ以外は灰でハイライト。
 */

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { ScheduleEntry } from '@/types/schedule';
import { getPendingTransfers } from '@/lib/api/schedule';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

interface PendingTransfersBoardProps {
  schoolIds: string[];
  /** クリックで親に通知（座席表のジャンプ先指定に使う） */
  onSelectEntry?: (entry: ScheduleEntry) => void;
  /** 何日以内を「間近」とみなすか。デフォルト 14 */
  thresholdDays?: number;
}

function daysUntil(targetDateStr: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(targetDateStr + 'T12:00:00');
  const tgt = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.round((tgt - today) / (24 * 60 * 60 * 1000));
}

export function PendingTransfersBoard({
  schoolIds,
  onSelectEntry,
  thresholdDays = 14,
}: PendingTransfersBoardProps) {
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // 既定は折りたたみ。0件でない限り常に出る帯なので、開いたままだと盤面を押し下げる。
  const [collapsed, setCollapsed] = useState(true);

  const load = useCallback(async () => {
    if (schoolIds.length === 0) {
      setEntries([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const data = await getPendingTransfers(schoolIds, thresholdDays);
      setEntries(data);
    } catch (e) {
      console.error('Failed to load pending transfers:', e);
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [schoolIds, thresholdDays]);

  useEffect(() => {
    load();
  }, [load]);

  // 0件なら表示しない（ノイズを増やさない）
  if (isLoading || entries.length === 0) return null;

  const overdueCount = entries.filter((e) => {
    const d = e.transfer_deadline ? daysUntil(e.transfer_deadline) : null;
    return d != null && d < 0;
  }).length;
  const soonCount = entries.length - overdueCount;

  return (
    <>
      {/* 振替保留のチップと同じ行に並ぶので、同じ寸法・同じ形（丸チップ）に揃える。
          以前は全幅の警告ボックスで、0件でない限り常に盤面を押し下げていた。 */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="inline-flex items-center gap-1.5 rounded-full border border-warning/50 bg-warning-subtle/60 px-2.5 py-0.5 text-xs font-semibold text-warning transition-colors hover:bg-warning-subtle print:hidden"
        title="クリックで振替期限の対応待ち一覧を表示"
      >
        <AlertTriangle className="w-3 h-3" />
        振替期限
        {overdueCount > 0 && <span className="font-bold text-danger">切れ{overdueCount}</span>}
        {soonCount > 0 && <span>間近{soonCount}</span>}
        <ChevronRight
          className={`w-3 h-3 opacity-70 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
        />
      </button>

      {!collapsed && (
        <div className="mt-1.5 w-full rounded-lg border border-warning bg-white max-h-80 overflow-y-auto">
          <ul className="divide-y divide-gray-100">
            {entries.map((entry) => {
              const studentName = entry.student
                ? `${entry.student.last_name} ${entry.student.first_name}（${formatGradeLabel(entry.student.grade)}）`
                : entry.student_id;
              const teacherName = entry.teacher?.display_name || entry.teacher?.email || '';
              const slotLabel = entry.time_slot ? `${entry.time_slot.slot_number}限` : '';
              const deadline = entry.transfer_deadline;
              const daysLeft = deadline ? daysUntil(deadline) : null;

              const chipClass = (() => {
                if (daysLeft == null) return 'bg-surface text-text-body';
                if (daysLeft < 0) return 'bg-danger-subtle text-danger';
                if (daysLeft <= 7) return 'bg-warning-subtle text-warning';
                return 'bg-surface text-text-body';
              })();
              const chipLabel = (() => {
                if (daysLeft == null) return '期限未設定';
                if (daysLeft < 0) return `期限切れ (${-daysLeft}日経過)`;
                if (daysLeft === 0) return '期限：今日';
                return `あと${daysLeft}日`;
              })();

              return (
                <li
                  key={entry.id}
                  className="px-4 py-3 hover:bg-warning-subtle/40 cursor-pointer transition-[background-color,border-color,color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.98]"
                  onClick={() => onSelectEntry?.(entry)}
                >
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{studentName}</div>
                      <div className="text-xs text-text-muted truncate">
                        欠席日: {entry.entry_date} {slotLabel} ・ 担当: {teacherName}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${chipClass}`}
                    >
                      {chipLabel}
                    </span>
                    <span className="text-xs text-text-faint flex-shrink-0">期限: {deadline}</span>
                    <ChevronRight className="w-4 h-4 text-text-faint flex-shrink-0" />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
