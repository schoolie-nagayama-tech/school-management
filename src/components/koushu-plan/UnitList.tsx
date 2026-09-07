'use client';

import type { RefObject } from 'react';
import type { CurriculumItem } from '@/types/database';
import { UnitRow } from '@/components/proposals/UnitRow';
import type { UnitDraft } from '@/components/proposals/proposalEditor.shared';

/**
 * 単元リスト（列ラベル行＋UnitRow の並び）。提案書エディタと講習テンプレートで共有する。
 *
 * 選択やドラッグの状態は親が持ち、この部品は表示とイベントの中継に徹する。
 * `listRef` を親から受け取るのは、フローティングピルの位置計算が
 * このコンテナの中を `[data-unit-idx]` で引くため（UnitRow が出力する契約を壊さない）。
 */
export function UnitList({
  items,
  drafts,
  isDone,
  appliedMode,
  groupMap,
  appliedGroupMap,
  dragging,
  listRef,
  showColumnHeader,
  showApplied = true,
  showIntent = true,
  onToggle,
  onSelectStart,
  onSelectEnter,
  onUpdate,
  onUngroup,
  onUngroupAll,
  onUngroupApplied,
  onUngroupAllApplied,
}: {
  items: CurriculumItem[];
  drafts: Map<number, UnitDraft>;
  /** 学校の進度で消化済みか（行のグレーアウト判定） */
  isDone: (curriculumItemId: number) => boolean;
  appliedMode: boolean;
  groupMap: Map<number, UnitDraft[]>;
  appliedGroupMap: Map<number, UnitDraft[]>;
  dragging: boolean;
  listRef: RefObject<HTMLDivElement>;
  /** 提案/申込の列ラベル行を出すか（有効な単元が1件も無いときは出さない） */
  showColumnHeader: boolean;
  /** 申込コマの列を出すか。講習テンプレートには「申込」が無いので false で使う */
  showApplied?: boolean;
  /** 指導意図のタグを出すか。テンプレートは意図を持たないので false で使う */
  showIntent?: boolean;
  onToggle: (curriculumItemId: number, shiftKey: boolean) => void;
  onSelectStart: (index: number, shiftKey: boolean) => void;
  onSelectEnter: (index: number) => void;
  onUpdate: (curriculumItemId: number, patch: Partial<UnitDraft>) => void;
  onUngroup: (curriculumItemId: number) => void;
  onUngroupAll: (groupId: number) => void;
  onUngroupApplied: (curriculumItemId: number) => void;
  onUngroupAllApplied: (groupId: number) => void;
}) {
  return (
    <>
      {showColumnHeader && (
        <div className="flex items-center justify-end gap-1 mb-1 pr-8 text-[10px] text-text-faint font-medium">
          <span className="w-[88px] text-center">提案</span>
          {showApplied && <span className="w-[88px] text-center">申込</span>}
        </div>
      )}

      <div ref={listRef} className={`space-y-1 ${dragging ? 'select-none' : ''}`}>
        {items.map((item, idx) => {
          const draft = drafts.get(item.id);
          if (!draft) return null;
          const done = isDone(item.id);
          const groupMembers = draft.group_id > 0 ? groupMap.get(draft.group_id) : undefined;
          const appliedGroupMembers =
            draft.applied_group_id > 0 ? appliedGroupMap.get(draft.applied_group_id) : undefined;

          return (
            <UnitRow
              key={item.id}
              index={idx}
              item={item}
              draft={draft}
              done={done}
              appliedMode={appliedMode}
              groupMembers={groupMembers}
              appliedGroupMembers={appliedGroupMembers}
              showApplied={showApplied}
              showIntent={showIntent}
              onToggle={(shiftKey) => onToggle(item.id, shiftKey)}
              onSelectStart={(shiftKey) => onSelectStart(idx, shiftKey)}
              onSelectEnter={() => onSelectEnter(idx)}
              onUpdate={(patch) => onUpdate(item.id, patch)}
              onUngroup={() => onUngroup(item.id)}
              onUngroupAll={() => draft.group_id > 0 && onUngroupAll(draft.group_id)}
              onUngroupApplied={() => onUngroupApplied(item.id)}
              onUngroupAllApplied={() =>
                draft.applied_group_id > 0 && onUngroupAllApplied(draft.applied_group_id)
              }
            />
          );
        })}
      </div>
    </>
  );
}
