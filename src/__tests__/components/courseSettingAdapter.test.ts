/**
 * 提案書の単元ドラフト ⇄ 講習テンプレートの単元設定 の相互変換テスト。
 *
 * 固定する規約:
 *   - group_id 0 ⇔ group_number null
 *   - 結合内のコマ数は「先頭のみ値・残りは0」（読み出し側が合計するため）
 *   - コマ0でもグループ内の単元は書き出す（片割れが欠けると結合が壊れる）
 *   - 取り込み時はグループ番号を振り直し、グループ内の0コマは1で有効化する
 */
import { describe, it, expect } from 'vitest';
import type { UnitDraft } from '@/components/proposals/proposalEditor.shared';
import { calcTotalKoma } from '@/lib/api/proposals';
import {
  courseSettingsToDrafts,
  draftsToCourseSettings,
  pickCourseSettingsForApply,
  type CourseCurriculumSetting,
} from '@/components/koushu-plan/courseSettingAdapter';
import type { DraftMap } from '@/components/koushu-plan/unitDraftLogic';

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

function makeDrafts(n: number, over: Record<number, Partial<UnitDraft>> = {}): DraftMap {
  const map: DraftMap = new Map();
  for (let i = 1; i <= n; i++) map.set(i, draft(i, over[i]));
  return map;
}

const order = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('draftsToCourseSettings', () => {
  it('コマが入っていない未グループの単元は書き出さない', () => {
    const units = [draft(1, { koma_count: 0 }), draft(2, { koma_count: 3 })];
    const out = draftsToCourseSettings(units, order(2));
    expect(out).toEqual([{ curriculum_item_id: 2, proposal_count: 3, group_number: null }]);
  });

  it('未グループは group_number を null にする', () => {
    const units = [draft(1, { koma_count: 2, group_id: 0 })];
    expect(draftsToCourseSettings(units, order(1))[0].group_number).toBeNull();
  });

  it('結合は先頭にだけコマを入れ、残りは0にする', () => {
    // 1,2,3 が同じグループ。先頭 1 のコマ数がグループのコマ数
    const units = [
      draft(1, { koma_count: 2, group_id: 5 }),
      draft(2, { koma_count: 2, group_id: 5 }),
      draft(3, { koma_count: 2, group_id: 5 }),
    ];
    const out = draftsToCourseSettings(units, order(3));
    expect(out).toEqual([
      { curriculum_item_id: 1, proposal_count: 2, group_number: 5 },
      { curriculum_item_id: 2, proposal_count: 0, group_number: 5 },
      { curriculum_item_id: 3, proposal_count: 0, group_number: 5 },
    ]);
    // 読み出し側はグループ内を合計するので、合計しても本来のコマ数に戻る
    expect(out.reduce((s, r) => s + r.proposal_count, 0)).toBe(2);
  });

  it('コマ0でもグループに属していれば書き出す（片割れを欠けさせない）', () => {
    const units = [
      draft(1, { koma_count: 4, group_id: 2 }),
      draft(2, { koma_count: 0, group_id: 2 }),
    ];
    const out = draftsToCourseSettings(units, order(2));
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ curriculum_item_id: 2, proposal_count: 0, group_number: 2 });
  });

  it('先頭は並び順で決まる（Mapの挿入順ではない）', () => {
    // 配列は 3,2,1 の順だが、並び順は 1,2,3 なので先頭は 1
    const units = [
      draft(3, { koma_count: 9, group_id: 1 }),
      draft(2, { koma_count: 9, group_id: 1 }),
      draft(1, { koma_count: 5, group_id: 1 }),
    ];
    const out = draftsToCourseSettings(units, order(3));
    expect(out[0]).toEqual({ curriculum_item_id: 1, proposal_count: 5, group_number: 1 });
    expect(out[1].proposal_count).toBe(0);
    expect(out[2].proposal_count).toBe(0);
  });

  it('書き出した合計が calcTotalKoma と一致する', () => {
    const units = [
      draft(1, { koma_count: 3, group_id: 0 }),
      draft(2, { koma_count: 2, group_id: 7 }),
      draft(3, { koma_count: 2, group_id: 7 }),
      draft(4, { koma_count: 1, group_id: 0 }),
    ];
    const written = draftsToCourseSettings(units, order(4)).reduce(
      (s, r) => s + r.proposal_count,
      0
    );
    // 3 + (グループ7で2コマ) + 1 = 6
    expect(written).toBe(6);
    expect(calcTotalKoma(units)).toBe(6);
  });
});

describe('courseSettingsToDrafts', () => {
  it('コマが入った単元を取り込む', () => {
    const base = makeDrafts(3);
    const settings: CourseCurriculumSetting[] = [
      { curriculum_item_id: 1, proposal_count: 4, group_number: null },
    ];
    const { drafts } = courseSettingsToDrafts(base, settings, 1);
    expect(drafts.get(1)?.koma_count).toBe(4);
    expect(drafts.get(1)?.group_id).toBe(0);
    expect(drafts.get(2)?.koma_count).toBe(0);
  });

  it('未グループかつ0コマは取り込まない', () => {
    const base = makeDrafts(2, { 1: { koma_count: 9 } });
    const settings: CourseCurriculumSetting[] = [
      { curriculum_item_id: 1, proposal_count: 0, group_number: null },
    ];
    const { drafts } = courseSettingsToDrafts(base, settings, 1);
    // 既存の値をそのまま残す（0で上書きしない）
    expect(drafts.get(1)?.koma_count).toBe(9);
  });

  it('グループ番号を startGroupId から振り直す', () => {
    const base = makeDrafts(4);
    const settings: CourseCurriculumSetting[] = [
      { curriculum_item_id: 1, proposal_count: 2, group_number: 5 },
      { curriculum_item_id: 2, proposal_count: 0, group_number: 5 },
      { curriculum_item_id: 3, proposal_count: 1, group_number: 8 },
      { curriculum_item_id: 4, proposal_count: 0, group_number: 8 },
    ];
    const { drafts, nextGroupId } = courseSettingsToDrafts(base, settings, 10);
    expect(drafts.get(1)?.group_id).toBe(10);
    expect(drafts.get(2)?.group_id).toBe(10);
    expect(drafts.get(3)?.group_id).toBe(11);
    expect(drafts.get(4)?.group_id).toBe(11);
    expect(nextGroupId).toBe(12);
  });

  it('グループ内の0コマは1で有効化する（合計は増えない）', () => {
    const base = makeDrafts(2);
    const settings: CourseCurriculumSetting[] = [
      { curriculum_item_id: 1, proposal_count: 3, group_number: 1 },
      { curriculum_item_id: 2, proposal_count: 0, group_number: 1 },
    ];
    const { drafts } = courseSettingsToDrafts(base, settings, 1);
    expect(drafts.get(1)?.koma_count).toBe(3);
    expect(drafts.get(2)?.koma_count).toBe(1);
    // グループは1回しか数えないので、先頭の3のまま
    expect(calcTotalKoma(Array.from(drafts.values()))).toBe(3);
  });

  it('元の Map を書き換えない', () => {
    const base = makeDrafts(1);
    courseSettingsToDrafts(
      base,
      [{ curriculum_item_id: 1, proposal_count: 5, group_number: null }],
      1
    );
    expect(base.get(1)?.koma_count).toBe(0);
  });
});

describe('pickCourseSettingsForApply（講習を生徒に適用するとき）', () => {
  it('結合の2件目以降（0コマ）を落とさない', () => {
    // 「先頭のみ規約」では 2,3 は0コマ。素朴に proposal_count>0 で絞ると
    // まとめた単元が先頭1件だけになって生徒に渡ってしまう（本番で実際に起きていた）
    const settings: CourseCurriculumSetting[] = [
      { curriculum_item_id: 1, proposal_count: 2, group_number: 5 },
      { curriculum_item_id: 2, proposal_count: 0, group_number: 5 },
      { curriculum_item_id: 3, proposal_count: 0, group_number: 5 },
    ];
    const out = pickCourseSettingsForApply(settings);
    expect(out.map((u) => u.curriculum_item_id)).toEqual([1, 2, 3]);
    // 同じグループに属したまま渡る
    expect(out.every((u) => u.group_id === 5)).toBe(true);
    // 0コマは1で有効化。合計はグループで1回しか数えないので増えない
    expect(out.map((u) => u.koma_count)).toEqual([2, 1, 1]);
    expect(calcTotalKoma(out)).toBe(2);
  });

  it('結合していない0コマの単元は落とす（使わない単元）', () => {
    const settings: CourseCurriculumSetting[] = [
      { curriculum_item_id: 1, proposal_count: 0, group_number: null },
      { curriculum_item_id: 2, proposal_count: 3, group_number: null },
    ];
    const out = pickCourseSettingsForApply(settings);
    expect(out).toEqual([{ curriculum_item_id: 2, koma_count: 3, group_id: 0 }]);
  });

  it('未結合は group_id を0にする（DBのnullを0へ変換）', () => {
    const out = pickCourseSettingsForApply([
      { curriculum_item_id: 1, proposal_count: 1, group_number: null },
    ]);
    expect(out[0].group_id).toBe(0);
  });

  it('書き出し → 適用 で単元の数と合計が保たれる', () => {
    // テンプレートに保存した内容が、そのまま生徒のプランに渡ること
    const units = [
      draft(1, { koma_count: 3, group_id: 0 }),
      draft(2, { koma_count: 2, group_id: 4 }),
      draft(3, { koma_count: 2, group_id: 4 }),
      draft(4, { koma_count: 2, group_id: 4 }),
    ];
    const saved = draftsToCourseSettings(units, order(4));
    const applied = pickCourseSettingsForApply(saved);
    expect(applied).toHaveLength(4);
    expect(calcTotalKoma(applied)).toBe(calcTotalKoma(units));
    expect(calcTotalKoma(applied)).toBe(5);
  });
});

describe('往復変換', () => {
  it('ドラフト → 設定 → ドラフト でコマ数と結合が保たれる', () => {
    const original = [
      draft(1, { koma_count: 3, group_id: 0 }),
      draft(2, { koma_count: 2, group_id: 4 }),
      draft(3, { koma_count: 1, group_id: 4 }),
      draft(4, { koma_count: 5, group_id: 0 }),
    ];
    const settings = draftsToCourseSettings(original, order(4));
    const { drafts } = courseSettingsToDrafts(makeDrafts(4), settings, 1);
    const back = Array.from(drafts.values());

    // 合計コマ数は保たれる（3 + グループ2 + 5 = 10）
    expect(calcTotalKoma(back)).toBe(calcTotalKoma(original));
    expect(calcTotalKoma(back)).toBe(10);
    // 結合の構造も保たれる（2と3が同じグループ）
    expect(drafts.get(2)?.group_id).toBe(drafts.get(3)?.group_id);
    expect(drafts.get(2)?.group_id).toBeGreaterThan(0);
    expect(drafts.get(1)?.group_id).toBe(0);
  });
});
