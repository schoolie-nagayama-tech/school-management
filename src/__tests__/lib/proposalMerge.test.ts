/**
 * 新規作成で、同じ生徒・同じ期・同じテキスト（過去問など）の提案書が既にあるときの足し込み。
 *
 * ★提案書は (生徒, テキスト, 季節, 年度) で一意。過去問の入ったテンプレを2つ（英語・数学）使うと、
 *   2つ目の保存が一意制約に当たって作れなかった。既存の1件に足す決まりを固定する。
 */
import { describe, it, expect } from 'vitest';
import {
  classifyExistingBooks,
  mergeIntoExistingUnits,
  type ExistingTermProposal,
} from '@/components/proposals/proposalMerge';
import { calcTotalKoma } from '@/lib/api/proposals';
import type { ProposalUnitInput } from '@/lib/api/proposals';

function u(
  curriculum_item_id: number,
  koma_count: number,
  group_id = 0,
  applied_group_id = 0
): ProposalUnitInput {
  return {
    curriculum_item_id,
    koma_count,
    applied_koma: null,
    reason: '',
    group_id,
    applied_group_id,
    intent_tag: null,
  };
}

describe('mergeIntoExistingUnits', () => {
  it('既存の単元（別の科目の分）を残し、今回の単元を後ろに足す', () => {
    const english = [u(100, 2), u(101, 2)];
    const math = [u(200, 3)];
    const out = mergeIntoExistingUnits(english, math);
    expect(out.map((x) => x.curriculum_item_id)).toEqual([100, 101, 200]);
  });

  it('同じ単元が両方にあるときは今回入れた数で置き換える', () => {
    const out = mergeIntoExistingUnits([u(100, 2), u(101, 2)], [u(101, 5)]);
    expect(out).toHaveLength(2);
    expect(out.find((x) => x.curriculum_item_id === 101)?.koma_count).toBe(5);
  });

  it('結合番号は既存の最大値の続きから振り、別々の結合が1つに数えられない', () => {
    // 英語: グループ1（2単元で3コマ）、数学: グループ1（2単元で4コマ）
    const english = [u(100, 3, 1, 1), u(101, 0, 1, 1)];
    const math = [u(200, 4, 1, 2), u(201, 0, 1, 2)];
    const out = mergeIntoExistingUnits(english, math);

    expect(out.find((x) => x.curriculum_item_id === 200)?.group_id).toBe(2);
    expect(out.find((x) => x.curriculum_item_id === 200)?.applied_group_id).toBe(3);
    // 番号がぶつかると 3 コマ（英語の結合だけ）になってしまう
    expect(calcTotalKoma(out)).toBe(7);
  });

  it('結合していない単元（0）はずらさない', () => {
    const out = mergeIntoExistingUnits([u(100, 1, 4)], [u(200, 2, 0)]);
    expect(out.find((x) => x.curriculum_item_id === 200)?.group_id).toBe(0);
  });
});

describe('classifyExistingBooks', () => {
  const e = (textbookId: number, status: ExistingTermProposal['status']): ExistingTermProposal => ({
    id: `p${textbookId}`,
    textbookId,
    status,
    theme: '英語 私立対策',
  });

  it('下書き・提案済は足し込み先、公開済は止める。提案書の無い冊はどちらにも入らない', () => {
    const { mergeInto, blocked } = classifyExistingBooks(
      [1, 2, 3, 4],
      [e(1, 'draft'), e(2, 'sent'), e(3, 'approved')]
    );
    expect(Array.from(mergeInto.keys())).toEqual([1, 2]);
    expect(blocked.map((b) => b.textbookId)).toEqual([3]);
  });
});
