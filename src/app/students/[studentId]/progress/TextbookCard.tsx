'use client';

import { CheckCircle2, Eye, EyeOff, GripVertical, Trash2 } from 'lucide-react';
import type { ActionGoal, StudentTextbookWithDetails } from '@/types/database';
import type { KoushuKomaSummary } from '@/lib/utils/koushuKoma';
import { KoushuKomaChip } from '@/components/progress/KoushuKomaBar';
import {
  SUBJECT_COLOR,
  isStalled,
  monthDayLabel,
  progressStats,
  seasonLabel,
  textbookGradeLabel,
  type SubjectColumn,
} from './newProgress.shared';

export function TextbookCard({
  textbook,
  isLive = false,
  lastUsedDate,
  koushuKoma,
  subjectColumn,
  activeExam,
  actionGoals,
  role,
  isMeeting,
  onOpen,
  canMoveUp,
  canMoveDown,
  onReorder,
  canDrag = false,
  isDragging = false,
  isDragOver = false,
  onDragStartCard,
  onDragOverCard,
  onDropCard,
  onDragEndCard,
  onTogglePublish,
  onDelete,
}: {
  textbook: StudentTextbookWithDetails;
  /** この科目で最後に授業に使ったテキストか（LIVE バッジ） */
  isLive?: boolean;
  /** 最終利用日 'YYYY-MM-DD'。LIVE の古さを判断できるよう併記する */
  lastUsedDate?: string;
  /** 講習のコマ集計（講習ラベル付きのテキストのみ）。残りコマチップを出す */
  koushuKoma?: KoushuKomaSummary;
  subjectColumn: SubjectColumn;
  activeExam: {
    id: string;
    exam_type_id: string | null;
    name: string;
    date: string | null;
    daysLeft: number | null;
    targetScore: number | null;
  } | null;
  actionGoals: ActionGoal[];
  role: 'teacher' | 'manager';
  isMeeting: boolean;
  onOpen: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onReorder: (dir: 'up' | 'down') => void;
  /** ドラッグ&ドロップでの並び替えを許可するか（教室長以上のみ。CardsView 側で判定して渡す） */
  canDrag?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStartCard?: () => void;
  onDragOverCard?: () => void;
  onDropCard?: () => void;
  onDragEndCard?: () => void;
  onTogglePublish?: () => void;
  onDelete?: () => void;
}) {
  const { stalled } = isStalled(textbook);
  const { total, done } = progressStats(textbook);
  const season = seasonLabel(textbook.season);
  // 学年はバッジをやめてテキスト名の頭に繋げる（「中3 フォレスタ」）。バッジ行の数を減らすため。
  const gradeLabel = textbookGradeLabel(textbook.textbook);
  const achievedCount = actionGoals.filter((g) => g.achieved).length;
  const tint = SUBJECT_COLOR[subjectColumn];
  // ▲▼・D&Dによる並べ替えは教室長以上のみ（講師には両方とも出さない）
  const canReorder = role === 'manager';

  const seasonColor =
    textbook.season === 'spring'
      ? 'border-l-[#f472b6]'
      : textbook.season === 'summer'
        ? 'border-l-[#fbbf24]'
        : textbook.season === 'winter'
          ? 'border-l-[#60a5fa]'
          : 'border-l-transparent';

  return (
    <div
      onClick={onOpen}
      draggable={canReorder && canDrag}
      onDragStart={
        canReorder && canDrag
          ? (e) => {
              // 本体クリック(onOpen)を誘発しないよう、ドラッグ中である旨だけ伝える
              e.dataTransfer.effectAllowed = 'move';
              onDragStartCard?.();
            }
          : undefined
      }
      onDragOver={
        canReorder && canDrag
          ? (e) => {
              e.preventDefault();
              onDragOverCard?.();
            }
          : undefined
      }
      onDrop={
        canReorder && canDrag
          ? (e) => {
              e.preventDefault();
              onDropCard?.();
            }
          : undefined
      }
      onDragEnd={canReorder && canDrag ? onDragEndCard : undefined}
      className={`bg-white rounded-lg border border-l-4 ${seasonColor} ${stalled ? 'border-amber-300' : 'border-[#e5e7eb]'} ${textbook.is_draft ? 'opacity-70 bg-[#fafafa]' : ''} ${isDragging ? 'opacity-40' : ''} ${isDragOver ? 'ring-2 ring-[#1e3a5f]/40' : ''} p-2 shadow-sm hover:shadow-md transition-[box-shadow] duration-150 ease-out cursor-pointer text-xs`}
    >
      {/* 並べ替えボタン（右上） */}
      <div className="flex items-start justify-between gap-1 mb-1">
        {/* 科目と季節は「どの箱の話か」を示すラベルなので、まとめて先頭に置く。
            季節をここに移した分、下のバッジ行は LIVE・残りコマ・非公開だけになる。 */}
        <div className="flex items-center gap-1 min-w-0">
          <span className={`text-[11px] font-bold ${tint.text}`}>{subjectColumn}</span>
          {season && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${
                textbook.season === 'spring'
                  ? 'bg-pink-100 text-pink-800 border-pink-300'
                  : textbook.season === 'summer'
                    ? 'bg-orange-100 text-orange-800 border-orange-300'
                    : 'bg-sky-100 text-sky-800 border-sky-300'
              }`}
            >
              {season}
            </span>
          )}
          {/* 完了ラベル。使い終わったテキストを一覧上でひと目で分けるため科目・季節の隣に置く */}
          {textbook.completed_at && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded font-bold border bg-emerald-50 text-emerald-700 border-emerald-300"
              title="使い終わったテキスト（完了）"
            >
              <CheckCircle2 className="w-2.5 h-2.5" />
              完了
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="w-5 h-5 rounded border border-[#e5e7eb] bg-white text-[#9ca3af] hover:text-red-500 hover:border-red-300 hover:bg-red-50 flex items-center justify-center transition-[background-color,color,border-color] duration-150 ease-out active:scale-[0.97]"
              title="削除"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          {onTogglePublish && (
            <button
              type="button"
              onClick={onTogglePublish}
              className={`w-5 h-5 rounded border leading-none flex items-center justify-center transition-[background-color,border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] ${
                textbook.is_draft
                  ? 'bg-gray-200 border-gray-400 text-gray-600 hover:bg-gray-300'
                  : 'bg-white border-[#e5e7eb] text-[#1e40af] hover:bg-[#eff6ff]'
              }`}
              title={
                textbook.is_draft
                  ? '講師に非公開（クリックで公開）'
                  : '講師に公開中（クリックで非公開）'
              }
            >
              {textbook.is_draft ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
          )}
          {canReorder && (
            <>
              <button
                type="button"
                disabled={!canMoveUp}
                onClick={() => onReorder('up')}
                className="w-5 h-5 rounded border border-[#e5e7eb] bg-white text-[11px] text-[#6b7280] hover:bg-[#f3f4f6] disabled:opacity-30 disabled:hover:bg-white transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
                title="上へ"
              >
                ▲
              </button>
              <button
                type="button"
                disabled={!canMoveDown}
                onClick={() => onReorder('down')}
                className="w-5 h-5 rounded border border-[#e5e7eb] bg-white text-[11px] text-[#6b7280] hover:bg-[#f3f4f6] disabled:opacity-30 disabled:hover:bg-white transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
                title="下へ"
              >
                ▼
              </button>
              {canDrag && (
                <span
                  className="w-5 h-5 flex items-center justify-center text-[#9ca3af] cursor-grab"
                  title="ドラッグして並び替え"
                >
                  <GripVertical className="w-3 h-3" />
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* タイトル行（学年はバッジにせず頭に繋げる: 「中3 フォレスタ」） */}
      <h3 className="font-semibold text-[#1f2937] text-[13px] leading-tight mb-1 line-clamp-2 break-words">
        {gradeLabel && <span className="text-[#6b7280] font-medium">{gradeLabel}　</span>}
        {textbook.textbook?.name ?? '教科書'}
      </h3>

      {/* バッジ（LIVE / 残りコマ / 非公開） */}
      <div className="flex items-center gap-1 mb-1.5 flex-wrap">
        {/* 同一科目に複数冊あるとき、今どれを使っているかを一目で示す。最優先で左端に置く。 */}
        {isLive && (
          <span
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md font-bold bg-emerald-600 text-white border border-emerald-700"
            title={
              lastUsedDate
                ? `この科目で最後に授業に使ったテキスト（${lastUsedDate}）`
                : 'この科目で最後に授業に使ったテキスト'
            }
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white" aria-hidden />
            LIVE
            {lastUsedDate && (
              <span className="font-normal opacity-90">{monthDayLabel(lastUsedDate)}</span>
            )}
          </span>
        )}
        {/* 講習の残りコマ。季節は上の科目の隣に移したので、ここは残りコマから始まる。
            面談モードでは出さない（申込コマは保護者に見せる情報ではないため、進行表と同じ扱い）。 */}
        {koushuKoma && koushuKoma.applied > 0 && !isMeeting && (
          <KoushuKomaChip summary={koushuKoma} />
        )}
        {textbook.is_draft && (
          <span className="text-[11px] px-1.5 py-0.5 bg-gray-200 text-gray-700 rounded font-bold border border-gray-400">
            非公開
          </span>
        )}
      </div>

      {/* 目標設定（コンパクト） */}
      {activeExam ? (
        <div className="mb-1.5 p-1.5 bg-gradient-to-br from-[#eff6ff] to-[#dbeafe]/50 border border-[#1e40af]/20 rounded">
          <div className="text-[11px] font-semibold text-[#1e3a5f] truncate mb-0.5">
            {activeExam.name}
          </div>
          <div className="flex items-center justify-between gap-1 text-[11px] text-[#1e3a5f]">
            {activeExam.daysLeft != null && activeExam.daysLeft < 0 ? (
              <span className="font-bold text-amber-600">試験終了</span>
            ) : (
              <span>
                残<strong className="text-sm font-bold ml-0.5">{activeExam.daysLeft ?? '—'}</strong>
                日
              </span>
            )}
            <span>
              目標
              <strong className="text-sm font-bold ml-0.5">{activeExam.targetScore ?? '—'}</strong>
            </span>
            <span>
              行動<strong className="text-sm font-bold ml-0.5">{achievedCount}</strong>/
              {actionGoals.length}
            </span>
          </div>
        </div>
      ) : (
        <div className="mb-1.5 px-1.5 py-1.5 bg-amber-50 border border-amber-300 rounded text-[11px] text-amber-700 text-center font-medium">
          目標未設定
        </div>
      )}

      {stalled && (
        <div className="mb-1 px-1.5 py-0.5 bg-amber-50 text-amber-800 text-[11px] rounded border border-amber-200 text-center">
          直近進捗なし
        </div>
      )}

      {/* 進捗サマリー */}
      <div className="text-[11px] text-[#6b7280] text-center">
        学習済み {done}/{total}
      </div>
    </div>
  );
}
