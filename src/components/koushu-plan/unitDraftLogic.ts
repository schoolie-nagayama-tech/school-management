/**
 * 単元編集（UnitDraft）の純粋ロジック。
 *
 * 生徒ごとの提案書エディタ（ProposalEditor）と、講習テンプレートの編集画面が同じ手つきになるよう、
 * React に依存しない部分だけをここに置く。状態は `Map<curriculum_item_id, UnitDraft>` で扱い、
 * 単元の並び順は呼び出し側が `orderedIds`（画面に出ている順の curriculum_item_id）で渡す。
 *
 * すべての関数は入力を書き換えず、新しい Map を返す（変更が無ければ元の Map をそのまま返す）。
 */
import type { UnitDraft } from '@/components/proposals/proposalEditor.shared';

export type DraftMap = Map<number, UnitDraft>;

/**
 * 結合の種類。提案結合と申込結合は「グループID」と「コマ数」の置き場が違うだけで操作は同じ。
 * 提案書では両方を使い、テンプレートでは提案側だけを使う。
 */
export type GroupKind = 'proposal' | 'applied';

const GROUP_FIELDS = {
  proposal: { group: 'group_id', koma: 'koma_count' },
  applied: { group: 'applied_group_id', koma: 'applied_koma' },
} as const satisfies Record<GroupKind, { group: keyof UnitDraft; koma: keyof UnitDraft }>;

/** 選択中の単元が並び順の何番目にいるか（昇順） */
export function selectedIndices(orderedIds: number[], drafts: DraftMap): number[] {
  const indices: number[] = [];
  orderedIds.forEach((id, idx) => {
    if (drafts.get(id)?.selected) indices.push(idx);
  });
  return indices;
}

export interface SelectionInfo {
  count: number;
  /** 2件以上かつ並び順で連続しているか。結合できるかの判定に使う */
  contiguous: boolean;
  firstIdx: number;
  lastIdx: number;
}

/** 選択状態の要約。フローティングの「まとめる」ボタンの出し分けに使う */
export function getSelectionInfo(orderedIds: number[], drafts: DraftMap): SelectionInfo {
  const indices = selectedIndices(orderedIds, drafts);
  let contiguous = indices.length >= 2;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) contiguous = false;
  }
  return {
    count: indices.length,
    contiguous,
    firstIdx: indices[0] ?? -1,
    lastIdx: indices[indices.length - 1] ?? -1,
  };
}

export type GroupFailure = 'too-few' | 'not-adjacent';
export type GroupResult = { ok: true; drafts: DraftMap } | { ok: false; reason: GroupFailure };

/**
 * 選択中の単元を新しいグループにまとめる。
 *
 * - 2件未満、または並び順で飛んでいる場合は失敗を返す（呼び出し側がトーストを出す）。
 * - すでに別のグループに属する単元も対象にでき、新しいグループで上書きする（まとめ直し運用）。
 * - 上書きの結果メンバーが1件だけになった旧グループは解散する（単独グループを残さない）。
 * - コマ数が未入力の単元は 1 を入れて有効化する（合計は先頭1件のみ計上されるため）。
 * - まとめたら選択は外す。
 */
export function groupSelectedUnits(
  drafts: DraftMap,
  orderedIds: number[],
  groupId: number,
  kind: GroupKind
): GroupResult {
  const { group: groupField, koma: komaField } = GROUP_FIELDS[kind];

  const selected = Array.from(drafts.values()).filter((d) => d.selected);
  if (selected.length < 2) return { ok: false, reason: 'too-few' };

  const selectedSet = new Set(selected.map((d) => d.curriculum_item_id));
  const indices = orderedIds
    .map((id, idx) => (selectedSet.has(id) ? idx : -1))
    .filter((i) => i >= 0);
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) return { ok: false, reason: 'not-adjacent' };
  }

  const next = new Map(drafts);
  // 上書き前に属していたグループ。ここから抜けた結果1件だけ残るグループは後で解散する
  const affectedGroupIds = new Set(
    selected.map((d) => d[groupField] as number).filter((g) => g > 0)
  );

  for (const s of selected) {
    const d = next.get(s.curriculum_item_id);
    if (!d) continue;
    next.set(s.curriculum_item_id, {
      ...d,
      [groupField]: groupId,
      [komaField]: (d[komaField] as number) || 1,
      selected: false,
    });
  }

  for (const oldGid of Array.from(affectedGroupIds)) {
    const remaining = Array.from(next.values()).filter((d) => d[groupField] === oldGid);
    if (remaining.length === 1) {
      const lone = remaining[0];
      next.set(lone.curriculum_item_id, { ...lone, [groupField]: 0 });
    }
  }

  return { ok: true, drafts: next };
}

/** 指定グループをまるごと解散する */
export function ungroupAllInGroup(drafts: DraftMap, groupId: number, kind: GroupKind): DraftMap {
  const groupField = GROUP_FIELDS[kind].group;
  const next = new Map(drafts);
  let changed = false;
  next.forEach((d, key) => {
    if (d[groupField] === groupId) {
      next.set(key, { ...d, [groupField]: 0 });
      changed = true;
    }
  });
  return changed ? next : drafts;
}

/** グループIDごとの所属単元。コマ数が入っている単元だけを対象にする */
export function buildGroupMap(activeUnits: UnitDraft[], kind: GroupKind): Map<number, UnitDraft[]> {
  const { group: groupField, koma: komaField } = GROUP_FIELDS[kind];
  const map = new Map<number, UnitDraft[]>();
  for (const u of activeUnits) {
    if (u[groupField] === 0) continue;
    // 申込側はコマ0の行を含めない（提案側は activeUnits の時点で絞り込み済み）
    if (kind === 'applied' && (u[komaField] as number) <= 0) continue;
    const gid = u[groupField] as number;
    const list = map.get(gid) ?? [];
    list.push(u);
    map.set(gid, list);
  }
  return map;
}

/**
 * Shift+クリックの範囲トグル。
 * 直前に触った行から今の行までを、直前の操作と同じ状態（選択 or 解除）に揃える。
 */
export function setSelectionRange(
  drafts: DraftMap,
  orderedIds: number[],
  fromId: number,
  toId: number,
  targetState: boolean
): DraftMap {
  const startIdx = orderedIds.indexOf(fromId);
  const endIdx = orderedIds.indexOf(toId);
  if (startIdx < 0 || endIdx < 0) return drafts;
  const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];

  const next = new Map(drafts);
  let changed = false;
  for (let idx = lo; idx <= hi; idx++) {
    const id = orderedIds[idx];
    const d = next.get(id);
    if (d && d.selected !== targetState) {
      next.set(id, { ...d, selected: targetState });
      changed = true;
    }
  }
  return changed ? next : drafts;
}

/**
 * なぞりドラッグの範囲選択（ラバーバンド）。
 * 範囲内はドラッグの向き（選択 or 解除）に、範囲外はドラッグ開始時の状態に戻す。
 * 戻す処理があるので、範囲を伸ばしたあと縮めても取り消せる。
 */
export function applyDragRange(
  drafts: DraftMap,
  orderedIds: number[],
  anchorIdx: number,
  currentIdx: number,
  mode: boolean,
  snapshot: Set<number>
): DraftMap {
  const [lo, hi] = anchorIdx <= currentIdx ? [anchorIdx, currentIdx] : [currentIdx, anchorIdx];
  const next = new Map(drafts);
  let changed = false;
  orderedIds.forEach((id, idx) => {
    const d = next.get(id);
    if (!d) return;
    const sel = idx >= lo && idx <= hi ? mode : snapshot.has(id);
    if (d.selected !== sel) {
      next.set(id, { ...d, selected: sel });
      changed = true;
    }
  });
  return changed ? next : drafts;
}

/** いま選択されている単元IDのスナップショット（ドラッグ開始時に控える） */
export function selectionSnapshot(drafts: DraftMap): Set<number> {
  const snap = new Set<number>();
  drafts.forEach((d, id) => {
    if (d.selected) snap.add(id);
  });
  return snap;
}

/** すべての選択を外す */
export function clearSelection(drafts: DraftMap): DraftMap {
  const next = new Map(drafts);
  let changed = false;
  next.forEach((d, id) => {
    if (d.selected) {
      next.set(id, { ...d, selected: false });
      changed = true;
    }
  });
  return changed ? next : drafts;
}
