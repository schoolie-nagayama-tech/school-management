'use client';

import { useMemo, useState } from 'react';
import type { ActionGoal, ExamType, StudentTextbookWithDetails } from '@/types/database';
import {
  SUBJECT_COLOR,
  SUBJECT_COLUMNS,
  activeExamOf,
  categorizeSubject,
  sortByOrder,
  type SubjectColumn,
  type ViewMode,
} from './newProgress.shared';
import { TextbookCard } from './TextbookCard';

// ─────────────────────────────────────────────
// カードビュー
// ─────────────────────────────────────────────
export function CardsView({
  textbooks,
  examTypes,
  actionGoalsByExam,
  role,
  viewMode,
  onSelect,
  onReorder,
  onReorderDrag,
  onAddTextbook,
  onTogglePublish,
  onDelete,
}: {
  textbooks: StudentTextbookWithDetails[];
  examTypes: ExamType[];
  actionGoalsByExam: Record<string, ActionGoal[]>;
  role: 'teacher' | 'manager';
  viewMode: ViewMode;
  onSelect: (id: string) => void;
  onReorder: (id: string, direction: 'up' | 'down') => void;
  /** ドラッグ&ドロップでの並び替え（教室長以上のみ使用可）。未指定ならD&D自体を無効化する。 */
  onReorderDrag?: (fromId: string, toId: string) => void;
  onAddTextbook?: (presetSubject?: string) => void;
  onTogglePublish?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const isMeeting = viewMode === 'meeting';
  // 並べ替え（▲▼・D&D共通）は教室長以上のみ。役割はページ側で 'manager' に丸めて渡されている。
  const canReorder = role === 'manager' && !!onReorderDrag;
  // ドラッグ中のテキストID（列をまたいでも状態は1つで良い。異なる列へのドロップは実処理側で無視される）
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // 科目ごとにグループ化
  const groups = useMemo(() => {
    const map: Record<SubjectColumn, StudentTextbookWithDetails[]> = {
      国語: [],
      数学: [],
      英語: [],
      理科: [],
      社会: [],
      その他: [],
    };
    for (const tb of textbooks) {
      map[categorizeSubject(tb.textbook?.subject)].push(tb);
    }
    for (const k of Object.keys(map) as SubjectColumn[]) {
      map[k] = sortByOrder(map[k]);
    }
    return map;
  }, [textbooks]);

  const hasOther = groups['その他'].length > 0;
  const allColumns: SubjectColumn[] = hasOther
    ? [...SUBJECT_COLUMNS, 'その他']
    : [...SUBJECT_COLUMNS];
  // 空の科目列は非表示
  const columns = allColumns.filter((c) => groups[c].length > 0);
  const colCount = columns.length;
  const colGridClass =
    colCount <= 1
      ? 'md:grid-cols-1'
      : colCount === 2
        ? 'md:grid-cols-2'
        : colCount === 3
          ? 'md:grid-cols-3'
          : colCount === 4
            ? 'md:grid-cols-4'
            : colCount === 5
              ? 'md:grid-cols-5'
              : 'md:grid-cols-6';

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-[#1f2937]">
            {isMeeting ? '面談用表示（保護者提示）' : 'テキスト一覧'}
          </h2>
          <p className="text-xs text-[#6b7280] mt-0.5">
            {isMeeting
              ? '保護者面談で画面共有 / PDF配布するためのプレゼンビュー'
              : `科目別表示 / カードをクリックで詳細テーブルへ${canReorder ? ' / ▲▼・ドラッグで並べ替え' : ''}`}
          </p>
        </div>
        {onAddTextbook && !isMeeting && (
          <button
            onClick={() => onAddTextbook()}
            className="px-3 py-1.5 bg-[#1e3a5f] text-white rounded-lg text-sm hover:bg-[#2a4d7a] transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
          >
            + テキスト追加
          </button>
        )}
      </div>
      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 ${colGridClass}`}>
        {columns.map((col) => {
          const tint = SUBJECT_COLOR[col];
          const items = groups[col];
          return (
            <div key={col} className="flex flex-col gap-2">
              <div
                className={`${tint.bg} ${tint.accent} border rounded-lg px-2 py-2 text-center sticky top-0`}
              >
                <div className={`${tint.text} text-lg font-bold leading-tight`}>{col}</div>
                <div className="text-[11px] text-[#6b7280] mt-0.5">{items.length} 冊</div>
              </div>
              {items.map((tb, i) => {
                const ae = activeExamOf(tb, examTypes);
                const goals = ae ? (actionGoalsByExam[ae.id] ?? []) : [];
                // ドラッグ中のカードが同じ列（同科目グループ）にあるときだけドロップ対象として扱う。
                // 異なる列へのドロップは並び順の意味が無いため、見た目上も反応させない。
                const draggingItem = draggingId
                  ? textbooks.find((t) => t.id === draggingId)
                  : undefined;
                const isDraggingInThisColumn =
                  !!draggingItem && categorizeSubject(draggingItem.textbook?.subject) === col;
                return (
                  <TextbookCard
                    key={tb.id}
                    textbook={tb}
                    subjectColumn={col}
                    activeExam={ae}
                    actionGoals={goals}
                    role={role}
                    isMeeting={isMeeting}
                    onOpen={() => onSelect(tb.id)}
                    canMoveUp={i > 0}
                    canMoveDown={i < items.length - 1}
                    onReorder={(dir) => onReorder(tb.id, dir)}
                    canDrag={canReorder}
                    isDragging={draggingId === tb.id}
                    isDragOver={
                      isDraggingInThisColumn && dragOverId === tb.id && draggingId !== tb.id
                    }
                    onDragStartCard={() => setDraggingId(tb.id)}
                    onDragOverCard={() => {
                      if (isDraggingInThisColumn) setDragOverId(tb.id);
                    }}
                    onDropCard={() => {
                      if (draggingId && draggingId !== tb.id && isDraggingInThisColumn) {
                        onReorderDrag?.(draggingId, tb.id);
                      }
                      setDraggingId(null);
                      setDragOverId(null);
                    }}
                    onDragEndCard={() => {
                      setDraggingId(null);
                      setDragOverId(null);
                    }}
                    onTogglePublish={onTogglePublish ? () => onTogglePublish(tb.id) : undefined}
                    onDelete={onDelete ? () => onDelete(tb.id) : undefined}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
