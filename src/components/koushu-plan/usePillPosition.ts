'use client';

import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { UnitDraft } from '@/components/proposals/proposalEditor.shared';

/** 単元リストの並び順を知るために必要な最小フィールド */
interface PositionableItem {
  id: number;
}

/**
 * フローティング「まとめる」ピルの表示位置を求める hook。
 *
 * 最後にチェックした行のチェックボックスの真横（縦中央）に合わせ、スクロールにも追従させる。
 * リストの DOM は `listRef` の中を `[data-unit-idx]` で引く（UnitRow が出力する契約）。
 */
export function usePillPosition({
  listRef,
  items,
  drafts,
  selectionCount,
  selectionLastIdx,
  pillAnchorId,
}: {
  listRef: RefObject<HTMLDivElement>;
  items: PositionableItem[];
  drafts: Map<number, UnitDraft>;
  selectionCount: number;
  /** 選択ブロック末尾行の index（アンカーが無効なときのフォールバック） */
  selectionLastIdx: number;
  /** 最後にチェック操作した単元ID */
  pillAnchorId: number | null;
}): { top: number; left: number } | null {
  const [pillPos, setPillPos] = useState<{ top: number; left: number } | null>(null);

  // ピルを出す行のindex。最後に操作した行が選択中ならそこ、無効なら選択ブロック末尾行にフォールバック。
  const pillAnchorIdx = useMemo(() => {
    if (pillAnchorId != null) {
      const d = drafts.get(pillAnchorId);
      if (d?.selected) {
        const idx = items.findIndex((i) => i.id === pillAnchorId);
        if (idx >= 0) return idx;
      }
    }
    return selectionLastIdx;
  }, [pillAnchorId, drafts, items, selectionLastIdx]);

  // 位置は「最後にチェックした行のチェックボックスの真横」。スクロール・リサイズで再計算する。
  useEffect(() => {
    if (selectionCount < 2 || pillAnchorIdx < 0) {
      setPillPos(null);
      return;
    }
    const update = () => {
      const cont = listRef.current;
      const el = cont?.querySelector(`[data-unit-idx="${pillAnchorIdx}"]`) as HTMLElement | null;
      if (!cont || !el) {
        setPillPos(null);
        return;
      }
      // 行内の先頭ボタン＝チェックボックス。その右隣・縦中央に出す。
      const checkbox = el.querySelector('button');
      const r = (checkbox ?? el).getBoundingClientRect();
      setPillPos({ top: r.top + r.height / 2, left: r.right + 8 });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
    // listRef は ref オブジェクトで同一性が変わらないため依存に含めない（元の実装と同じ発火条件を保つ）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionCount, pillAnchorIdx]);

  return pillPos;
}
