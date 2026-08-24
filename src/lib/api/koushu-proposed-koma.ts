/**
 * 講習提案書から「科目別の提案コマ数」を取り出す（管理側＝申込管理の取り込み用）
 *
 * 用途:
 *   申込管理で室長が生徒を追加するとき、科目ごとのコマ数を手で打たせない。
 *   保護者に出した提案書（＝Web申込で保護者が見た数字）をそのまま初期値にする。
 *
 * ★ コマ数の数え方を保護者向けフォームと必ず揃えること:
 *   集計は `lib/utils/koushuApplyPure.ts` の純関数（sumProposalUnitsKoma /
 *   aggregateProposalsBySubject）をそのまま使う。ここで自前に数え直すと、
 *   結合グループ（group_id>0）の二重計上でコマ数が倍にズレる。
 *   保護者が見た数字と室長が見る数字が違う、という最悪の事故になるので、
 *   集計ロジックは絶対に複製しないこと。
 *
 * ★ 公開経路の loadProposalLines（koushuApply.ts）と分けている理由:
 *   あちらは未ログインの保護者向けに service role で RLS をバイパスする専用モジュール。
 *   こちらはログイン済みスタッフのブラウザクライアント（RLS 有効）から読む。
 *   同じ関数にまとめると service role のクライアントがブラウザ側に混入しうるので分ける。
 *   共有するのは「数え方」（純関数）だけでよい。
 */

import { supabase } from '@/lib/supabase';
import {
  aggregateProposalsBySubject,
  sumProposalUnitsKoma,
  type ProposalSubjectInput,
} from '@/lib/utils/koushuApplyPure';
import type { SeasonType } from '@/types/database';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface ProposedKomaResult {
  /** subjectId → 提案コマ数。0 の科目は含めない。 */
  komaBySubject: Record<string, number>;
  /**
   * 科目が解決できず取り込めなかった提案書の枚数。
   * textbooks.subject_id が未設定だと科目に紐づけられない。0 でなければ画面で知らせる
   * （黙って落とすと「提案したのに取り込まれない」原因が分からない）。
   */
  unresolvedCount: number;
}

/**
 * 生徒×季節×年 の提案書（status が sent / approved のもの）から科目別コマ数を返す。
 * 提案が無ければ空を返す（エラーにしない。提案書なしで申込を受けることもあるため）。
 */
export async function getProposedKomaBySubject(
  studentId: string,
  season: SeasonType,
  year: number
): Promise<ProposedKomaResult> {
  const empty: ProposedKomaResult = { komaBySubject: {}, unresolvedCount: 0 };

  // 下書き（draft）は保護者に出していないので取り込まない。出した提案だけを初期値にする。
  const { data: proposalRows, error: proposalErr } = await db
    .from('seasonal_proposals')
    .select('id, textbook_id')
    .eq('student_id', studentId)
    .eq('season', season)
    .eq('year', year)
    .in('status', ['sent', 'approved']);
  if (proposalErr) {
    console.error('[koushu-proposed-koma] 提案書の取得に失敗:', proposalErr);
    throw new Error('提案書の取得に失敗しました');
  }
  const proposals = (proposalRows ?? []) as Array<{ id: string; textbook_id: number | null }>;
  if (proposals.length === 0) return empty;

  const { data: unitRows } = await db
    .from('seasonal_proposal_units')
    .select('proposal_id, koma_count, group_id')
    .in(
      'proposal_id',
      proposals.map((p) => p.id)
    );
  const units = (unitRows ?? []) as Array<{
    proposal_id: string;
    koma_count: number;
    group_id: number;
  }>;
  const unitsByProposal = new Map<string, Array<{ groupId: number; komaCount: number }>>();
  for (const u of units) {
    const list = unitsByProposal.get(u.proposal_id) ?? [];
    list.push({ groupId: u.group_id, komaCount: u.koma_count });
    unitsByProposal.set(u.proposal_id, list);
  }

  const textbookIds = Array.from(
    new Set(proposals.map((p) => p.textbook_id).filter((id): id is number => id != null))
  );
  const { data: textbookRows } =
    textbookIds.length > 0
      ? await db.from('textbooks').select('id, subject_id').in('id', textbookIds)
      : { data: [] };
  const subjectIdByTextbook = new Map(
    ((textbookRows ?? []) as Array<{ id: number; subject_id: string | null }>).map((t) => [
      t.id,
      t.subject_id,
    ])
  );

  const inputs: ProposalSubjectInput[] = [];
  let unresolvedCount = 0;
  for (const p of proposals) {
    const subjectId = p.textbook_id != null ? subjectIdByTextbook.get(p.textbook_id) : null;
    if (!subjectId) {
      unresolvedCount++;
      continue;
    }
    inputs.push({
      subjectId,
      // 名前・テーマ・形式はコマ数の集計に影響しない。ここでは数だけ欲しいので空で埋める。
      subjectName: '',
      textbookName: '',
      theme: null,
      koma: sumProposalUnitsKoma(unitsByProposal.get(p.id) ?? []),
      ratio: 2,
      duration: 90,
    });
  }

  const komaBySubject: Record<string, number> = {};
  for (const a of aggregateProposalsBySubject(inputs)) {
    if (a.proposedKoma > 0) komaBySubject[a.subjectId] = a.proposedKoma;
  }
  return { komaBySubject, unresolvedCount };
}
