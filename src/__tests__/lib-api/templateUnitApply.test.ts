/**
 * 講習テンプレートを生徒に適用するときの「単元の入れ替え方」のテスト。
 *
 * 提案書は (student_id, textbook_id, season, year) で一意なので、同じ教材（過去問など）を含む
 * テンプレートを複数（英語コースと数学コース）同じ生徒に当てると、同じ1件の提案書に集まる。
 * 以前は提案書の単元を全部消してから入れ直していたため、後から当てたテンプレが前のテンプレの
 * 単元を消していた（中3に5教科ぶん当てると最後の1科目しか残らない）。
 * ここでは「自分の単元だけを入れ替える」「番号は残っている単元の続きから振る」を固定する。
 */
import { describe, it, expect, vi } from 'vitest';
import { planTemplateUnitDeletes, buildTemplateUnitInserts } from '@/lib/api/seasonalCourses';

// seasonalCourses は import 時に supabase クライアントを掴むので、純関数のテストでも差し替える。
// vi.mock はファイル先頭に巻き上げられるため、ファクトリの中で完結させる（外の変数は参照できない）。
vi.mock('@/lib/supabase', () => {
  const client = { from: vi.fn() };
  return {
    supabase: client,
    getSupabaseBrowserClient: () => client,
    createSupabaseBrowserClient: () => client,
  };
});

describe('planTemplateUnitDeletes', () => {
  it('テンプレートが持つ単元と、その教材の提案書だけを消す対象にする', () => {
    const plans = planTemplateUnitDeletes([
      { proposalIds: ['p1', 'p2'], curriculumItemIds: [10, 11] },
      { proposalIds: ['p3'], curriculumItemIds: [20] },
    ]);
    expect(plans).toEqual([
      { proposalIds: ['p1', 'p2'], curriculumItemIds: [10, 11] },
      { proposalIds: ['p3'], curriculumItemIds: [20] },
    ]);
  });

  it('単元が無い・対象の提案書が無い組は落とす（空の .in() でクエリを増やさない）', () => {
    const plans = planTemplateUnitDeletes([
      { proposalIds: [], curriculumItemIds: [10] },
      { proposalIds: ['p1'], curriculumItemIds: [] },
    ]);
    expect(plans).toEqual([]);
  });
});

describe('buildTemplateUnitInserts', () => {
  const settings = [
    { curriculum_item_id: 10, koma_count: 2, group_id: 0 },
    { curriculum_item_id: 11, koma_count: 1, group_id: 1 },
    { curriculum_item_id: 12, koma_count: 0, group_id: 1 },
  ];

  it('残っている単元が無ければ 0 から振る（従来と同じ並び）', () => {
    const rows = buildTemplateUnitInserts('p1', settings, null);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.group_id)).toEqual([0, 1, 1]);
    expect(rows.every((r) => r.proposal_id === 'p1')).toBe(true);
    // 下書きでは申込は未確定
    expect(rows.every((r) => r.applied_koma === 0)).toBe(true);
  });

  it('他のテンプレートの単元が残っていれば、その続きの番号から振る', () => {
    const rows = buildTemplateUnitInserts('p1', settings, { sortOrder: 4, groupId: 2 });
    expect(rows.map((r) => r.sort_order)).toEqual([5, 6, 7]);
    // 結合番号もずらす。別々の結合が同じ番号になると合計が1コマ分しか数えられない
    expect(rows.map((r) => r.group_id)).toEqual([0, 3, 3]);
  });

  it('結合していない単元（group_id=0）はずらさない', () => {
    const rows = buildTemplateUnitInserts(
      'p1',
      [{ curriculum_item_id: 10, koma_count: 2, group_id: 0 }],
      { sortOrder: 9, groupId: 5 }
    );
    expect(rows[0].group_id).toBe(0);
  });
});
