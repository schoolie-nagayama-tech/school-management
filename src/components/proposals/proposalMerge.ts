// 新規作成で、同じ生徒・同じ期・同じテキストの提案書が既にあるときに、単元を足し込む純粋ロジック。
//
// ★提案書は (生徒, テキスト, 季節, 年度) で一意（DBの UNIQUE 制約）。過去問は1冊に全科目が
//   載るので、英語のテンプレ（サミングアップ＋過去問）と数学のテンプレ（精選＋過去問）を
//   同じ生徒に使うと、過去問の提案書は1件に集まる。新しく作ろうとすると制約に当たって保存できなかった。
//   テンプレを生徒にまとめて登録する道（applyCoursesToStudents）と同じく、既存の1件に足す。
//
// 決まり（applyCoursesToStudents とそろえる）:
//  - 既存の単元は残す（別の科目の分）。
//  - 同じ単元が両方にあるときは、今回入れたほうで置き換える（同じテンプレを当て直したときに
//    自分の分だけ入れ替わる）。
//  - 結合番号（group_id / applied_group_id）は既存の最大値の続きから振る。
//    ★結合の合計は提案書内で group_id ごとに1回しか数えない（calcTotalKoma）ので、
//    英語のグループ1と数学のグループ1がぶつかると別々の結合が1つに数えられコマが足りなくなる。
import type { ProposalUnitInput } from '@/lib/api/proposals';

export function mergeIntoExistingUnits(
  existing: ProposalUnitInput[],
  incoming: ProposalUnitInput[]
): ProposalUnitInput[] {
  const incomingIds = new Set(incoming.map((u) => u.curriculum_item_id));
  const kept = existing.filter((u) => !incomingIds.has(u.curriculum_item_id));
  const groupBase = Math.max(0, ...kept.map((u) => u.group_id));
  const appliedGroupBase = Math.max(0, ...kept.map((u) => u.applied_group_id));
  return [
    ...kept,
    ...incoming.map((u) => ({
      ...u,
      group_id: u.group_id > 0 ? groupBase + u.group_id : 0,
      applied_group_id: u.applied_group_id > 0 ? appliedGroupBase + u.applied_group_id : 0,
    })),
  ];
}

/** 同じ期に既にある提案書（新規作成の画面で、足し込み先として使う） */
export interface ExistingTermProposal {
  id: string;
  textbookId: number;
  status: 'draft' | 'sent' | 'approved';
  theme: string;
}

/**
 * 新規作成の冊のうち、既にある提案書に足し込むもの／足し込めないものを分ける（純関数）。
 * ★公開済み（approved）には足さない。公開は進行表と同期済みで、ここで単元だけ足すと
 *   進行表とずれる。公開済みの提案書を開いて、そこで足してもらう。
 */
export function classifyExistingBooks(
  bookIds: number[],
  existing: ExistingTermProposal[]
): { mergeInto: Map<number, ExistingTermProposal>; blocked: ExistingTermProposal[] } {
  const byTextbook = new Map(existing.map((e) => [e.textbookId, e]));
  const mergeInto = new Map<number, ExistingTermProposal>();
  const blocked: ExistingTermProposal[] = [];
  for (const id of bookIds) {
    const e = byTextbook.get(id);
    if (!e) continue;
    if (e.status === 'approved') blocked.push(e);
    else mergeInto.set(id, e);
  }
  return { mergeInto, blocked };
}
