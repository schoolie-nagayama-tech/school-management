/**
 * 単元編集ロジック（提案書エディタとテンプレート編集で共有）のテスト。
 *
 * ProposalEditor から純粋ロジックを切り出した際の「挙動が変わっていないこと」の担保。
 * 特に次の規約を固定する:
 *   - 結合は隣接する2件以上のみ
 *   - まとめ直しで片割れ1件になった旧グループは解散する
 *   - コマ数未入力の単元は結合時に1が入る
 *   - なぞりドラッグは範囲外をドラッグ開始時の状態へ戻す（ラバーバンド）
 */
import { describe, it, expect } from 'vitest';
import type { UnitDraft } from '@/components/proposals/proposalEditor.shared';
import {
  applyDragRange,
  buildGroupMap,
  clearSelection,
  getSelectionInfo,
  groupSelectedUnits,
  selectionSnapshot,
  setSelectionRange,
  ungroupAllInGroup,
  type DraftMap,
} from '@/components/koushu-plan/unitDraftLogic';

function draft(id: number, over: Partial<UnitDraft> = {}): UnitDraft {
  return {
    curriculum_item_id: id,
    koma_count: 0,
    applied_koma: 0,
    reason: '',
    selected: false,
    group_id: 0,
    applied_group_id: 0,
    intent_tag: null,
    ...over,
  };
}

/** id=1..n の単元を並び順どおりに作る */
function makeDrafts(n: number, over: Record<number, Partial<UnitDraft>> = {}): DraftMap {
  const map: DraftMap = new Map();
  for (let i = 1; i <= n; i++) map.set(i, draft(i, over[i]));
  return map;
}

const order = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('getSelectionInfo', () => {
  it('連続した2件以上の選択を contiguous と判定する', () => {
    const d = makeDrafts(5, { 2: { selected: true }, 3: { selected: true } });
    expect(getSelectionInfo(order(5), d)).toEqual({
      count: 2,
      contiguous: true,
      firstIdx: 1,
      lastIdx: 2,
    });
  });

  it('飛んだ選択は contiguous にしない', () => {
    const d = makeDrafts(5, { 1: { selected: true }, 4: { selected: true } });
    expect(getSelectionInfo(order(5), d).contiguous).toBe(false);
  });

  it('1件だけの選択は contiguous にしない（結合できない）', () => {
    const d = makeDrafts(5, { 3: { selected: true } });
    const info = getSelectionInfo(order(5), d);
    expect(info.count).toBe(1);
    expect(info.contiguous).toBe(false);
  });
});

describe('groupSelectedUnits', () => {
  it('選択が2件未満なら too-few で失敗する', () => {
    const d = makeDrafts(3, { 1: { selected: true } });
    const r = groupSelectedUnits(d, order(3), 1, 'proposal');
    expect(r).toEqual({ ok: false, reason: 'too-few' });
  });

  it('隣接していなければ not-adjacent で失敗する', () => {
    const d = makeDrafts(4, { 1: { selected: true }, 3: { selected: true } });
    const r = groupSelectedUnits(d, order(4), 1, 'proposal');
    expect(r).toEqual({ ok: false, reason: 'not-adjacent' });
  });

  it('隣接2件をまとめ、コマ未入力には1を入れて選択を外す', () => {
    const d = makeDrafts(3, {
      1: { selected: true, koma_count: 2 },
      2: { selected: true, koma_count: 0 },
    });
    const r = groupSelectedUnits(d, order(3), 7, 'proposal');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.drafts.get(1)).toMatchObject({ group_id: 7, koma_count: 2, selected: false });
    // 未入力は1で有効化される（合計は先頭1件のみ計上されるため0のままだと消えてしまう）
    expect(r.drafts.get(2)).toMatchObject({ group_id: 7, koma_count: 1, selected: false });
    expect(r.drafts.get(3)).toMatchObject({ group_id: 0 });
  });

  it('元の Map を書き換えない', () => {
    const d = makeDrafts(2, { 1: { selected: true }, 2: { selected: true } });
    groupSelectedUnits(d, order(2), 9, 'proposal');
    expect(d.get(1)?.group_id).toBe(0);
    expect(d.get(1)?.selected).toBe(true);
  });

  it('まとめ直しで片割れ1件になった旧グループは解散する', () => {
    // 1,2,3 が旧グループ5。2,3 を新グループへ移すと 1 だけが残るので解散させる
    const d = makeDrafts(4, {
      1: { group_id: 5, koma_count: 1 },
      2: { group_id: 5, koma_count: 1, selected: true },
      3: { group_id: 5, koma_count: 1, selected: true },
    });
    const r = groupSelectedUnits(d, order(4), 8, 'proposal');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.drafts.get(2)?.group_id).toBe(8);
    expect(r.drafts.get(3)?.group_id).toBe(8);
    expect(r.drafts.get(1)?.group_id).toBe(0);
  });

  it('旧グループに2件以上残るなら解散しない', () => {
    // 1,2,3,4 が旧グループ5。3,4 を移しても 1,2 が残るのでグループ5は生きたまま
    const d = makeDrafts(5, {
      1: { group_id: 5, koma_count: 1 },
      2: { group_id: 5, koma_count: 1 },
      3: { group_id: 5, koma_count: 1, selected: true },
      4: { group_id: 5, koma_count: 1, selected: true },
    });
    const r = groupSelectedUnits(d, order(5), 8, 'proposal');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.drafts.get(1)?.group_id).toBe(5);
    expect(r.drafts.get(2)?.group_id).toBe(5);
  });

  it('申込結合は applied_group_id と applied_koma を触り、提案側には影響しない', () => {
    const d = makeDrafts(3, {
      1: { selected: true, koma_count: 3, applied_koma: 0 },
      2: { selected: true, koma_count: 4, applied_koma: 2 },
    });
    const r = groupSelectedUnits(d, order(3), 4, 'applied');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.drafts.get(1)).toMatchObject({
      applied_group_id: 4,
      applied_koma: 1,
      // 提案側は素通し
      koma_count: 3,
      group_id: 0,
    });
    expect(r.drafts.get(2)).toMatchObject({ applied_group_id: 4, applied_koma: 2, koma_count: 4 });
  });
});

describe('ungroupAllInGroup', () => {
  it('同じグループの単元をまとめて解散する', () => {
    const d = makeDrafts(4, {
      1: { group_id: 3 },
      2: { group_id: 3 },
      3: { group_id: 9 },
    });
    const next = ungroupAllInGroup(d, 3, 'proposal');
    expect(next.get(1)?.group_id).toBe(0);
    expect(next.get(2)?.group_id).toBe(0);
    // 別グループは触らない
    expect(next.get(3)?.group_id).toBe(9);
  });

  it('該当が無ければ同じ Map を返す（余計な再描画を起こさない）', () => {
    const d = makeDrafts(3);
    expect(ungroupAllInGroup(d, 42, 'proposal')).toBe(d);
  });
});

describe('buildGroupMap', () => {
  it('提案側はグループIDごとに単元をまとめる', () => {
    const units = [
      draft(1, { group_id: 2, koma_count: 1 }),
      draft(2, { group_id: 2, koma_count: 1 }),
      draft(3, { group_id: 0, koma_count: 1 }),
    ];
    const map = buildGroupMap(units, 'proposal');
    expect(map.get(2)).toHaveLength(2);
    expect(map.has(0)).toBe(false);
  });

  it('申込側は申込コマが0の単元を除く', () => {
    const units = [
      draft(1, { applied_group_id: 3, applied_koma: 2 }),
      // 提案コマだけ入っていて申込は0。申込グループの集計には入れない
      draft(2, { applied_group_id: 3, applied_koma: 0, koma_count: 5 }),
    ];
    const map = buildGroupMap(units, 'applied');
    expect(map.get(3)).toHaveLength(1);
  });
});

describe('setSelectionRange（Shift+クリック）', () => {
  it('起点から終点までを指定した状態に揃える', () => {
    const d = makeDrafts(5, { 2: { selected: true } });
    const next = setSelectionRange(d, order(5), 2, 4, true);
    expect(next.get(2)?.selected).toBe(true);
    expect(next.get(3)?.selected).toBe(true);
    expect(next.get(4)?.selected).toBe(true);
    expect(next.get(5)?.selected).toBe(false);
  });

  it('逆向き（下から上）でも同じ範囲になる', () => {
    const d = makeDrafts(5);
    const next = setSelectionRange(d, order(5), 4, 2, true);
    expect([2, 3, 4].every((i) => next.get(i)?.selected)).toBe(true);
    expect(next.get(1)?.selected).toBe(false);
  });

  it('解除方向にも使える', () => {
    const d = makeDrafts(4, { 1: { selected: true }, 2: { selected: true } });
    const next = setSelectionRange(d, order(4), 1, 2, false);
    expect(next.get(1)?.selected).toBe(false);
    expect(next.get(2)?.selected).toBe(false);
  });

  it('並びに無いIDなら何もしない', () => {
    const d = makeDrafts(3);
    expect(setSelectionRange(d, order(3), 99, 2, true)).toBe(d);
  });
});

describe('applyDragRange（なぞり選択）', () => {
  // 引数は「並び順のインデックス」であってIDではない。id=1 は index=0。
  const at = (id: number) => id - 1;

  it('範囲内を選択し、範囲外は開始時の状態に戻す', () => {
    // 5 は開始時から選択済み。範囲外なので選択が保たれる
    const d = makeDrafts(5, { 5: { selected: true } });
    const snap = selectionSnapshot(d);
    const next = applyDragRange(d, order(5), at(1), at(2), true, snap);
    expect(next.get(1)?.selected).toBe(true);
    expect(next.get(2)?.selected).toBe(true);
    expect(next.get(3)?.selected).toBe(false);
    expect(next.get(5)?.selected).toBe(true);
  });

  it('伸ばした範囲を縮めると、外れた行が開始時の状態に戻る', () => {
    const d = makeDrafts(5);
    const snap = selectionSnapshot(d);
    const wide = applyDragRange(d, order(5), at(1), at(4), true, snap);
    expect(wide.get(4)?.selected).toBe(true);
    const narrow = applyDragRange(wide, order(5), at(1), at(2), true, snap);
    // 範囲から外れた 3,4 は開始時（未選択）に戻る
    expect(narrow.get(3)?.selected).toBe(false);
    expect(narrow.get(4)?.selected).toBe(false);
    expect(narrow.get(1)?.selected).toBe(true);
  });

  it('選択済みの行から始めたドラッグは解除方向になる', () => {
    const d = makeDrafts(4, {
      1: { selected: true },
      2: { selected: true },
      3: { selected: true },
    });
    const snap = selectionSnapshot(d);
    const next = applyDragRange(d, order(4), at(1), at(2), false, snap);
    expect(next.get(1)?.selected).toBe(false);
    expect(next.get(2)?.selected).toBe(false);
    // 範囲外は開始時のまま
    expect(next.get(3)?.selected).toBe(true);
  });
});

describe('clearSelection', () => {
  it('選択をすべて外す', () => {
    const d = makeDrafts(3, { 1: { selected: true }, 3: { selected: true } });
    const next = clearSelection(d);
    expect(Array.from(next.values()).some((x) => x.selected)).toBe(false);
  });

  it('選択が無ければ同じ Map を返す', () => {
    const d = makeDrafts(3);
    expect(clearSelection(d)).toBe(d);
  });
});
