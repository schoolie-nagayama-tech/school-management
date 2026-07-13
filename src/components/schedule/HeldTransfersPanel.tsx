'use client';

/**
 * HeldTransfersPanel（Phase P2）
 *
 * 振替の「保留プール」= 振替元(transferred_out)にしたが振替先が未定のコマ一覧。
 * 座席表上部に折りたたみパネル（TestPrepPlacementPanel と同系）で表示し、
 * 各行の「配置」ボタンで汎用配置モード（placingAdhoc:'transfer'）を開始する。
 *
 * - 生徒名・元日程（日付/コマ）・科目チップ・期限残日数チップ（期限超過は danger 色）
 * - 「配置」→ 親が placingAdhoc('transfer') 開始。同じ行を再クリックで解除（親側でトグル）
 * - 保留が0件なら何も描画しない（ノイズを増やさない）
 *
 * 期限14日フィルタ付きの督促ボード（PendingTransfersBoard）とは別物で、
 * こちらは期限に関係なく「未配置の振替」を全部見せて配置導線を提供する。
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui';
import { RefreshCw, X } from 'lucide-react';
import type { ScheduleEntry } from '@/types/schedule';
import { getHeldTransfers } from '@/lib/api/schedule';

interface Props {
  schoolIds: string[];
  /** 配置成功・保留追加時に親からインクリメントして再取得させる。 */
  refreshKey?: number;
  /** 科目ID → 科目名（チップ表示用）。 */
  subjectNameById: Map<string, string>;
  /** 配置モード中の対象エントリID（ハイライト＋ボタン文言切替）。 */
  placingEntryId?: string | null;
  /** 「配置」クリック: 親が placingAdhoc('transfer') を開始（同じ行の再クリックで解除）。 */
  onStartPlacement: (entry: ScheduleEntry) => void;
}

function gradeLabel(g: number): string {
  if (g <= 6) return `小${g}`;
  if (g <= 9) return `中${g - 6}`;
  return `高${g - 9}`;
}

function daysUntil(targetDateStr: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(targetDateStr + 'T12:00:00');
  const tgt = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.round((tgt - today) / (24 * 60 * 60 * 1000));
}

function dowLabel(date: string): string {
  const d = new Date(date + 'T12:00:00');
  return ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
}

export function HeldTransfersPanel({
  schoolIds,
  refreshKey,
  subjectNameById,
  placingEntryId,
  onStartPlacement,
}: Props) {
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  const schoolIdsKey = schoolIds.join(',');

  const load = useCallback(async () => {
    if (schoolIds.length === 0) {
      setEntries([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const data = await getHeldTransfers(schoolIds);
      setEntries(data);
    } catch (e) {
      console.error('Failed to load held transfers:', e);
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolIdsKey]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // 0件なら表示しない
  if (isLoading || entries.length === 0) return null;

  return (
    <Card className="border-info">
      <CardContent className="p-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center gap-2 mb-2 text-left"
        >
          <RefreshCw className="w-4 h-4 text-info" />
          <span className="font-semibold text-sm">振替の保留プール</span>
          <span className="text-xs text-text-muted">未配置 {entries.length} 件</span>
          <X
            className={`ml-auto w-4 h-4 text-text-faint transition-transform duration-150 ${
              collapsed ? 'rotate-45' : ''
            }`}
          />
        </button>

        {!collapsed && (
          <div className="max-h-60 overflow-y-auto">
            <ul className="divide-y divide-border-subtle">
              {entries.map((entry) => {
                const studentName = entry.student
                  ? `${entry.student.last_name} ${entry.student.first_name}（${gradeLabel(entry.student.grade)}）`
                  : (entry.student_id ?? '生徒');
                const slotLabel = entry.time_slot ? `${entry.time_slot.slot_number}限` : '';
                const subjectNames = (entry.subject_ids ?? [])
                  .map((id) => subjectNameById.get(id))
                  .filter((n): n is string => !!n);
                const deadline = entry.transfer_deadline;
                const daysLeft = deadline ? daysUntil(deadline) : null;
                const chipClass =
                  daysLeft == null
                    ? 'bg-surface text-text-body'
                    : daysLeft < 0
                      ? 'bg-danger-subtle text-danger'
                      : daysLeft <= 7
                        ? 'bg-warning-subtle text-warning'
                        : 'bg-surface text-text-body';
                const chipLabel =
                  daysLeft == null
                    ? '期限未設定'
                    : daysLeft < 0
                      ? `期限切れ ${-daysLeft}日`
                      : daysLeft === 0
                        ? '期限：今日'
                        : `あと${daysLeft}日`;
                const isPlacing = placingEntryId === entry.id;

                return (
                  <li key={entry.id} className="py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{studentName}</div>
                      <div className="text-[11px] text-text-muted truncate flex items-center gap-1.5 mt-0.5">
                        <span>
                          元: {entry.entry_date.slice(5)}({dowLabel(entry.entry_date)}) {slotLabel}
                        </span>
                        {subjectNames.map((n) => (
                          <span
                            key={n}
                            className="px-1.5 py-0.5 rounded bg-white border border-border-subtle text-[10px]"
                          >
                            {n}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${chipClass}`}
                    >
                      {chipLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => onStartPlacement(entry)}
                      className={`text-xs px-2 py-0.5 rounded active:scale-[0.97] transition-[background-color,transform] duration-150 flex-shrink-0 ${
                        isPlacing
                          ? 'bg-info text-white'
                          : 'bg-white border border-info text-info hover:bg-info-subtle'
                      }`}
                    >
                      {isPlacing ? '終了' : '配置'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
