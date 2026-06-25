'use client';

import { Eye, EyeOff, Trash2 } from 'lucide-react';
import type { ActionGoal, StudentTextbookWithDetails } from '@/types/database';
import {
  SUBJECT_COLOR,
  isStalled,
  progressStats,
  seasonLabel,
  type SubjectColumn,
} from './newProgress.shared';

export function TextbookCard({
  textbook,
  subjectColumn,
  activeExam,
  actionGoals,
  role: _role,
  isMeeting: _isMeeting,
  onOpen,
  canMoveUp,
  canMoveDown,
  onReorder,
  onTogglePublish,
  onDelete,
}: {
  textbook: StudentTextbookWithDetails;
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
  onTogglePublish?: () => void;
  onDelete?: () => void;
}) {
  const { stalled } = isStalled(textbook);
  const { total, done } = progressStats(textbook);
  const season = seasonLabel(textbook.season);
  const achievedCount = actionGoals.filter((g) => g.achieved).length;
  const tint = SUBJECT_COLOR[subjectColumn];

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
      className={`bg-white rounded-lg border border-l-4 ${seasonColor} ${stalled ? 'border-amber-300' : 'border-[#e5e7eb]'} ${textbook.is_draft ? 'opacity-70 bg-[#fafafa]' : ''} p-2 shadow-sm hover:shadow-md transition-[box-shadow] duration-150 ease-out cursor-pointer text-xs`}
    >
      {/* 並べ替えボタン（右上） */}
      <div className="flex items-start justify-between gap-1 mb-1">
        <div className={`text-[11px] font-bold ${tint.text}`}>{subjectColumn}</div>
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
        </div>
      </div>

      {/* タイトル行 */}
      <h3 className="font-semibold text-[#1f2937] text-[13px] leading-tight mb-1 line-clamp-2 break-words">
        {textbook.textbook?.name ?? '教科書'}
      </h3>

      {/* バッジ（学年 / 季節 / 非公開） */}
      <div className="flex items-center gap-1 mb-1.5 flex-wrap">
        {textbook.textbook?.grade && (
          <span
            className={`text-xs px-2 py-0.5 rounded-md ${tint.bg} ${tint.text} font-bold border ${tint.accent}`}
          >
            {textbook.textbook.grade}
          </span>
        )}
        {season && (
          <span
            className={`text-xs px-2 py-0.5 rounded-md font-bold border ${
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
            <span>
              残<strong className="text-sm font-bold ml-0.5">{activeExam.daysLeft ?? '—'}</strong>日
            </span>
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
