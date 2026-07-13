'use client';

/**
 * HeldTransfersPanel（Phase P2 / P2改訂で「配置待ちプール」に統合）
 *
 * 座席表上部の折りたたみパネル（TestPrepPlacementPanel と同系）に2セクションを持つ:
 *   1. 振替の保留（transferred_out で振替先未定）
 *   2. 未消化の追加授業（schedule_pending_lessons の残コマ束）
 *
 * UI判断（P2改訂）: 別々に2枚のパネルを並べるより、1枚に2セクションで統合した方が
 * 座席表上部がすっきりする。両方0件ならパネル自体を描画しない（ノイズを増やさない）。
 *
 * - 振替行: 生徒名・元日程・科目チップ・期限（YYYY-MM-DD（残N日））。「配置」で placingAdhoc:'transfer'。
 * - 追加授業行: 対象者名・科目・種別・残Nコマ。「配置」で placingAdhoc:'lesson'（残数 target）。「削除」で行削除。
 *
 * 期限14日フィルタ付きの督促ボード（PendingTransfersBoard）とは別物で、
 * こちらは期限に関係なく「未配置の振替」を全部見せて配置導線を提供する。
 */

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronRight, Layers, Trash2 } from 'lucide-react';
import type { ScheduleEntry } from '@/types/schedule';
import { getHeldTransfers } from '@/lib/api/schedule';
import {
  getPendingLessons,
  deletePendingLesson,
  type PendingLesson,
} from '@/lib/api/pending-lessons';

interface Props {
  schoolIds: string[];
  /** 配置成功・保留追加時に親からインクリメントして再取得させる。 */
  refreshKey?: number;
  /** 科目ID → 科目名（チップ表示用）。 */
  subjectNameById: Map<string, string>;
  /** 配置モード中の対象エントリID（振替: ハイライト＋ボタン文言切替）。 */
  placingEntryId?: string | null;
  /** 配置モード中の対象プールID（追加授業: ハイライト＋ボタン文言切替）。 */
  placingPendingLessonId?: string | null;
  /** 「配置」クリック（振替）: 親が placingAdhoc('transfer') を開始（同じ行の再クリックで解除）。 */
  onStartPlacement: (entry: ScheduleEntry) => void;
  /** 「配置」クリック（追加授業）: 親が placingAdhoc('lesson') を残数 target で再開。 */
  onStartPendingPlacement: (pending: PendingLesson) => void;
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

const KIND_LABEL: Record<string, string> = { additional: '追加授業', trial: '体験授業' };

export function HeldTransfersPanel({
  schoolIds,
  refreshKey,
  subjectNameById,
  placingEntryId,
  placingPendingLessonId,
  onStartPlacement,
  onStartPendingPlacement,
}: Props) {
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [pending, setPending] = useState<PendingLesson[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // 既定は折りたたみ（未配置チップと同じテイストの小さなチップだけ出す）。
  const [collapsed, setCollapsed] = useState(true);

  const schoolIdsKey = schoolIds.join(',');

  const load = useCallback(async () => {
    if (schoolIds.length === 0) {
      setEntries([]);
      setPending([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      // 振替保留と未消化プールを並列取得。プール取得は API 側でエラーを握りつぶして [] を返す。
      const [held, pend] = await Promise.all([
        getHeldTransfers(schoolIds),
        getPendingLessons(schoolIds),
      ]);
      setEntries(held);
      setPending(pend);
    } catch (e) {
      console.error('Failed to load placement pool:', e);
      setEntries([]);
      setPending([]);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolIdsKey]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const handleDeletePending = useCallback(async (pl: PendingLesson) => {
    const name = pl.student
      ? `${pl.student.last_name}${pl.student.first_name}`
      : (pl.inquiry?.student_name ?? '対象者');
    if (!window.confirm(`${name} の未消化プール（残${pl.remaining_count}コマ）を削除しますか？`))
      return;
    try {
      await deletePendingLesson(pl.id);
      setPending((prev) => prev.filter((p) => p.id !== pl.id));
    } catch (e) {
      console.error('Failed to delete pending lesson:', e);
    }
  }, []);

  // 両方0件なら表示しない
  if (isLoading || (entries.length === 0 && pending.length === 0)) return null;

  const totalCount = entries.length + pending.length;

  // 未配置チップと同じテイストの小さなチップ（info=青系）＋クリックで展開。
  // 展開部は w-full にして flex-wrap の行内では次行にフル幅で回り込む。
  return (
    <>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-info-subtle/60 border border-info/40 text-xs text-info font-semibold hover:bg-info-subtle transition-colors print:hidden"
        title="クリックで配置待ちの一覧（振替の保留など）を表示"
      >
        <RefreshCw className="w-3 h-3" />
        振替保留 {totalCount}
        <ChevronRight
          className={`w-3 h-3 opacity-70 transition-transform duration-150 ${
            collapsed ? '' : 'rotate-90'
          }`}
        />
      </button>

      {!collapsed && (
        <div className="w-full rounded-lg border border-info/30 bg-info-subtle/20 p-2 max-h-72 overflow-y-auto space-y-3 print:hidden">
          {/* 1. 振替の保留 */}
          {entries.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1 text-[11px] font-semibold text-text-muted">
                <RefreshCw className="w-3.5 h-3.5 text-info" />
                振替の保留（{entries.length}）
              </div>
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
                  // 期限は「YYYY-MM-DD（残N日）」形式で絶対日付＋残日数を併記する（P2改訂 point 2）。
                  const relLabel =
                    daysLeft == null
                      ? ''
                      : daysLeft < 0
                        ? `期限切れ ${-daysLeft}日`
                        : daysLeft === 0
                          ? '残0日'
                          : `残${daysLeft}日`;
                  const chipLabel = deadline
                    ? `${deadline}${relLabel ? `（${relLabel}）` : ''}`
                    : '期限未設定';
                  const isPlacing = placingEntryId === entry.id;

                  return (
                    <li key={entry.id} className="py-2 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{studentName}</div>
                        <div className="text-[11px] text-text-muted truncate flex items-center gap-1.5 mt-0.5">
                          <span>
                            元: {entry.entry_date.slice(5)}({dowLabel(entry.entry_date)}){' '}
                            {slotLabel}
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
                        title={deadline ?? undefined}
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

          {/* 2. 未消化の追加授業 */}
          {pending.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1 text-[11px] font-semibold text-text-muted">
                <Layers className="w-3.5 h-3.5 text-info" />
                未消化の追加授業（{pending.length}）
              </div>
              <ul className="divide-y divide-border-subtle">
                {pending.map((pl) => {
                  const name = pl.student
                    ? `${pl.student.last_name} ${pl.student.first_name}（${gradeLabel(pl.student.grade)}）`
                    : pl.inquiry
                      ? `${pl.inquiry.student_name ?? '見込み客'}（見込み客）`
                      : '対象者';
                  const subjName = subjectNameById.get(pl.subject_id);
                  const isPlacing = placingPendingLessonId === pl.id;
                  return (
                    <li key={pl.id} className="py-2 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{name}</div>
                        <div className="text-[11px] text-text-muted truncate flex items-center gap-1.5 mt-0.5">
                          <span>{KIND_LABEL[pl.kind] ?? pl.kind}</span>
                          {subjName && (
                            <span className="px-1.5 py-0.5 rounded bg-white border border-border-subtle text-[10px]">
                              {subjName}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0 bg-surface text-text-body">
                        残{pl.remaining_count}コマ
                      </span>
                      <button
                        type="button"
                        onClick={() => onStartPendingPlacement(pl)}
                        className={`text-xs px-2 py-0.5 rounded active:scale-[0.97] transition-[background-color,transform] duration-150 flex-shrink-0 ${
                          isPlacing
                            ? 'bg-info text-white'
                            : 'bg-white border border-info text-info hover:bg-info-subtle'
                        }`}
                      >
                        {isPlacing ? '終了' : '配置'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePending(pl)}
                        className="text-text-faint hover:text-danger p-0.5 flex-shrink-0"
                        title="この未消化プールを削除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
