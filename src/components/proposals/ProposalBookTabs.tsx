'use client';

/**
 * テキストのタブ（1冊目・2冊目…）。ドラッグで順番を入れ替えられる。
 * 提案書の新規作成（ProposalEditor）と講習テンプレの編集（CourseEditor）で共有する。
 * テンプレで決めた順番が、そのテンプレから作る提案書の初めの並びになる。
 *
 * ★タブの並び＝保存する順＝created_at の順＝「上から進める順」。印刷で同じ科目を
 *   1枚にまとめるときの並びにもなる。テンプレから作ると並びはテンプレの登録順で入るが、
 *   生徒によって進める順が違うので、保存前にここで入れ替えられるようにした。
 * ★つかむのはグリップだけ。タブ全体をつかめるようにすると、タブを押して切り替えるつもりが
 *   ずれて入れ替わってしまう。グリップはキーボードの←→でも動かせる（dnd-kit の KeyboardSensor）。
 * ★状態は冊のID（textbookId）で持っているので、並びを変えても入力は消えない。
 */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import { reorderBooks } from './proposalMultiBook';

export interface BookTabItem {
  textbookId: number;
  label: string;
  koma: number;
}

export function ProposalBookTabs({
  books,
  selectedTextbookId,
  onSwitch,
  onRemove,
  onReorder,
  alwaysRemovable = false,
  removeTarget = '提案書',
}: {
  books: BookTabItem[];
  selectedTextbookId: number | null;
  onSwitch: (textbookId: number) => void;
  onRemove: (textbookId: number) => void;
  /** 並べ替え後の textbookId の並び */
  onReorder: (orderedIds: number[]) => void;
  /**
   * 1冊だけでも「外す」を出すか。提案書は1冊も無いと作れないので出さない。
   * テンプレ（講習）は全部外すとテキスト選択に戻れるので、1冊でも外せる。
   */
  alwaysRemovable?: boolean;
  /** 「◯◯から外す」の読み上げ文言。提案書／講習（テンプレ）で呼び名が違う */
  removeTarget?: string;
}) {
  const sensors = useSensors(
    // 少し動かしてから掴む。グリップを押しただけで掴まないように
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = books.map((b) => b.textbookId);
    onReorder(reorderBooks(ids, Number(e.active.id), Number(e.over.id)));
  };

  const sortable = books.length > 1;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={books.map((b) => b.textbookId)}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex gap-2 flex-wrap">
          {books.map((b, i) => (
            <BookTab
              key={b.textbookId}
              book={b}
              order={i + 1}
              isActive={selectedTextbookId === b.textbookId}
              sortable={sortable}
              removable={alwaysRemovable || books.length > 1}
              removeTarget={removeTarget}
              onSwitch={onSwitch}
              onRemove={onRemove}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function BookTab({
  book,
  order,
  isActive,
  sortable,
  removable,
  removeTarget,
  onSwitch,
  onRemove,
}: {
  book: BookTabItem;
  order: number;
  isActive: boolean;
  sortable: boolean;
  removable: boolean;
  removeTarget: string;
  onSwitch: (textbookId: number) => void;
  onRemove: (textbookId: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: book.textbookId,
    disabled: !sortable,
  });

  return (
    // タブ本体と「外す」は別のボタンにする。
    // 入れ子のボタンはHTMLとして不正で、キーボードから「外す」に到達できなくなる。
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex items-center rounded-lg text-sm font-medium transition-[background-color,color] duration-150 ${
        isActive
          ? 'bg-ink text-text-on-primary'
          : 'bg-surface-hover text-text-body hover:bg-border-default'
      } ${isDragging ? 'relative z-10 shadow-md' : ''}`}
    >
      {sortable && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`${book.label} の順番を入れ替える（ドラッグ、または←→キー）`}
          title="ドラッグして順番を入れ替え"
          className={`pl-1.5 py-1.5 rounded-l-lg cursor-grab active:cursor-grabbing touch-none ${
            isActive
              ? 'text-text-on-primary/60 hover:text-text-on-primary'
              : 'text-text-faint hover:text-text-muted'
          }`}
        >
          <GripVertical className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onSwitch(book.textbookId)}
        aria-pressed={isActive}
        className={`${sortable ? 'pl-1' : 'pl-3 rounded-l-lg'} ${removable ? 'pr-2' : 'pr-3 rounded-r-lg'} py-1.5`}
      >
        <span
          className={`mr-1.5 text-[11px] tabular-nums ${
            isActive ? 'text-text-on-primary/70' : 'text-text-faint'
          }`}
        >
          {order}冊目
        </span>
        {book.label}
        <span
          className={`ml-1.5 text-[11px] tabular-nums ${
            isActive ? 'text-text-on-primary/70' : 'text-text-muted'
          }`}
        >
          {book.koma}コマ
        </span>
      </button>
      {removable && (
        <button
          type="button"
          onClick={() => onRemove(book.textbookId)}
          aria-label={`${book.label} を${removeTarget}から外す`}
          title="このテキストを外す"
          className={`pr-2.5 pl-1 py-1.5 rounded-r-lg transition-[color] duration-150 ${
            isActive
              ? 'text-text-on-primary/60 hover:text-text-on-primary'
              : 'text-text-faint hover:text-danger'
          }`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
