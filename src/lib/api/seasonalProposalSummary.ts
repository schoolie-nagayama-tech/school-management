/**
 * 面談ワークスペース向け「講習の提案書（seasonal_proposals）」の期ごとのまとめ。
 *
 * ★なぜ koushu_enrollments ではなく提案書を読むのか:
 *   本番の koushu_enrollments は0行で、実際の講習は提案書（生徒×テキスト×期）で回っている
 *  （2026夏期だけで approved 575行／232名）。面談の⑤で「講習: 申込なし」と出続けていたのは、
 *   読む先を間違えていたため。koushu_enrollments は2027-02公開のWeb申込の入力源なので、
 *   消さずに足し込む側（interview.shared.ts の mergeKoushuSeasons）で合流させる。
 *
 * ★科目の出し方は koushu-proposed-koma.ts / koushuApply.ts の loadProposalLines と同じ道筋で、
 *   textbook_id → textbooks。ただしあちらはコマ数を単元（seasonal_proposal_units）から
 *   数え直すのに対し、こちらは提案書行の applied_koma（＝申込コマの確定値）をそのまま足す。
 *   面談で言いたいのは「いくつ取ったか」で、提案の内訳ではないため。
 *
 * ★ブラウザ（ログイン済みスタッフ・RLS有効）から読む。service role は使わない。
 */

import { supabase } from '@/lib/supabase';
import type { PlanProposalDetail, PlanUnitDetail } from '@/lib/interview/planExplain';

// 講習系の他モジュール（seasonalCourses.ts / koushu-proposed-koma.ts）と同じく、
// 生成型に未反映の列があるため any でクエリする。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** 提案書の状態。期ごとに1つへ丸める（approved > sent > draft） */
export type SeasonalProposalStatus = 'draft' | 'sent' | 'approved';

/** 1つの期（年度×季節）ぶんのまとめ */
export interface SeasonalProposalSeasonSummary {
  /** 年度。1〜3月は前年度に属する（seasonal_proposals.year がそのまま年度） */
  year: number;
  /** 'spring' | 'summer' | 'winter'（DBの値をそのまま持つ） */
  season: string;
  /** 期の状態。1件でも approved があれば approved、無ければ sent、それも無ければ draft */
  status: SeasonalProposalStatus;
  /** 科目名（表示用の日本語）→ applied_koma の合計。0コマの科目も残す（落とすのは呼び出し側） */
  komaBySubject: Record<string, number>;
  /** その期の applied_koma の総和 */
  totalKoma: number;
}

/**
 * 教材ID → 科目名（表示用）と教材名。
 * ★期ごとのまとめ（getSeasonalProposalSummaryByStudent）と⑤のプランの中身（getCurrentPlanDetail）で
 *   科目の出し方を1か所にそろえる。片方だけ直すと、⑤の見出しのコマ数と科目カードの科目名がずれる。
 */
async function loadTextbookLabels(ids: ReadonlyArray<number | null>): Promise<{
  subjectLabelByTextbook: Map<number, string>;
  nameByTextbook: Map<number, string>;
}> {
  const textbookIds = Array.from(new Set(ids.filter((id): id is number => id != null)));
  const { data: textbookRows } =
    textbookIds.length > 0
      ? await db
          .from('textbooks')
          .select('id, name, subject, subject_id')
          .in('id', textbookIds)
          .limit(500)
      : { data: [] };
  const textbooks = (textbookRows ?? []) as Array<{
    id: number;
    name: string | null;
    subject: string | null;
    subject_id: string | null;
  }>;

  /**
   * ★textbooks.subject が空の教材がある（過去問など「1冊に全科目」の教材は
   *   subject を空にして単元側で科目を持たせている）。空のときは subject_id から
   *   科目マスタの名前を引く。どちらも無ければ「科目不明」にして、黙って落とさない。
   */
  const missingSubjectIds = Array.from(
    new Set(
      textbooks.filter((t) => !t.subject?.trim() && t.subject_id).map((t) => t.subject_id as string)
    )
  );
  const { data: subjectRows } =
    missingSubjectIds.length > 0
      ? await db.from('subjects').select('id, name').in('id', missingSubjectIds).limit(500)
      : { data: [] };
  const subjectNameById = new Map(
    ((subjectRows ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name])
  );

  const subjectLabelByTextbook = new Map<number, string>();
  const nameByTextbook = new Map<number, string>();
  for (const t of textbooks) {
    const label =
      t.subject?.trim() || (t.subject_id ? (subjectNameById.get(t.subject_id) ?? '') : '');
    subjectLabelByTextbook.set(t.id, label || '科目不明');
    nameByTextbook.set(t.id, t.name?.trim() ?? '');
  }
  return { subjectLabelByTextbook, nameByTextbook };
}

/** 状態の強さ。丸めるときの優先順位 */
const STATUS_RANK: Record<SeasonalProposalStatus, number> = { draft: 0, sent: 1, approved: 2 };

/**
 * 生徒1人の提案書を期（年度×季節）ごとにまとめる。
 *
 * ★status での絞り込みはここではしない（下書きも返す）。今期は「下書き」と出したいが
 *   履歴は approved だけ、というように出し分けの規則が呼び出し側ごとに違うため。
 * ★行が無ければ空配列。エラーにしない（提案書が無い生徒のほうが多い）。
 */
export async function getSeasonalProposalSummaryByStudent(
  studentId: string
): Promise<SeasonalProposalSeasonSummary[]> {
  // ★未ページングの select は1000行で黙って切られる。1人ぶんで超えることは無いが上限を明示する
  const { data: proposalRows, error } = await db
    .from('seasonal_proposals')
    .select('season, year, status, applied_koma, textbook_id')
    .eq('student_id', studentId)
    .limit(500);
  if (error) {
    console.error('[seasonalProposalSummary] 提案書の取得に失敗:', error);
    return [];
  }

  const proposals = (proposalRows ?? []) as Array<{
    season: string | null;
    year: number | null;
    status: string | null;
    applied_koma: number | null;
    textbook_id: number | null;
  }>;
  if (proposals.length === 0) return [];

  const { subjectLabelByTextbook } = await loadTextbookLabels(proposals.map((p) => p.textbook_id));

  const byKey = new Map<string, SeasonalProposalSeasonSummary>();
  for (const p of proposals) {
    if (!p.season || p.year == null) continue;
    const key = `${p.year}-${p.season}`;
    const bucket = byKey.get(key) ?? {
      year: p.year,
      season: p.season,
      status: 'draft' as SeasonalProposalStatus,
      komaBySubject: {},
      totalKoma: 0,
    };

    const status: SeasonalProposalStatus =
      p.status === 'approved' || p.status === 'sent' ? p.status : 'draft';
    if (STATUS_RANK[status] > STATUS_RANK[bucket.status]) bucket.status = status;

    const koma = p.applied_koma ?? 0;
    const subject =
      p.textbook_id != null
        ? (subjectLabelByTextbook.get(p.textbook_id) ?? '科目不明')
        : '科目不明';
    bucket.komaBySubject[subject] = (bucket.komaBySubject[subject] ?? 0) + koma;
    bucket.totalKoma += koma;

    byKey.set(key, bucket);
  }

  return Array.from(byKey.values());
}

/**
 * ⑤プラン提示の科目カードの材料。今期（年度×季節）の提案書を、単元つきで返す。
 *
 * ★status では絞らない（下書きも返す）。⑤は下書きでも「提案中のプラン」として説明したいため。
 *   状態の言い方は呼び出し側（KOUSHU_STATUS_LABEL）で出す。
 * ★申込コマ・結合グループの読み替え（下書きは提案の値を使う等）は純粋関数側
 *  （lib/interview/planExplain.ts）でする。ここは行をそのまま運ぶだけ。
 * ★行が無ければ空配列。エラーにしない（今期の提案書が無い生徒のほうが多い）。
 */
export async function getCurrentPlanDetail(
  studentId: string,
  year: number,
  season: string
): Promise<PlanProposalDetail[]> {
  // ★未ページングの select は1000行で黙って切られる。1人×1期で超えることは無いが上限を明示する
  const { data: proposalRows, error } = await db
    .from('seasonal_proposals')
    .select('id, textbook_id, status, theme, applied_koma, created_at')
    .eq('student_id', studentId)
    .eq('year', year)
    .eq('season', season)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) {
    console.error('[seasonalProposalSummary] 今期の提案書の取得に失敗:', error);
    return [];
  }
  const proposals = (proposalRows ?? []) as Array<{
    id: string;
    textbook_id: number | null;
    status: string | null;
    theme: string | null;
    applied_koma: number | null;
  }>;
  if (proposals.length === 0) return [];

  /**
   * ★単元は1教材で数十行になりうる（過去問・大学受験の器は第1回〜第30回）。
   *   教材が10冊あれば1000行に届くので、上限を広めに取り、並びは提案書→sort_order で決め打つ。
   */
  const { data: unitRows, error: unitError } = await db
    .from('seasonal_proposal_units')
    .select(
      'proposal_id, curriculum_item_id, koma_count, applied_koma, group_id, applied_group_id, sort_order, reason'
    )
    .in(
      'proposal_id',
      proposals.map((p) => p.id)
    )
    .order('sort_order', { ascending: true })
    .limit(3000);
  if (unitError) {
    console.error('[seasonalProposalSummary] 今期の提案単元の取得に失敗:', unitError);
  }
  const units = (unitRows ?? []) as Array<{
    proposal_id: string;
    curriculum_item_id: number;
    koma_count: number | null;
    applied_koma: number | null;
    group_id: number | null;
    applied_group_id: number | null;
    sort_order: number | null;
    reason: string | null;
  }>;

  const itemIds = Array.from(new Set(units.map((u) => u.curriculum_item_id)));
  const { data: itemRows } =
    itemIds.length > 0
      ? await db.from('curriculum_items').select('id, title').in('id', itemIds).limit(3000)
      : { data: [] };
  const titleByItem = new Map(
    ((itemRows ?? []) as Array<{ id: number; title: string | null }>).map((i) => [
      i.id,
      i.title ?? '',
    ])
  );

  const { subjectLabelByTextbook, nameByTextbook } = await loadTextbookLabels(
    proposals.map((p) => p.textbook_id)
  );

  const unitsByProposal = new Map<string, PlanUnitDetail[]>();
  for (const u of units) {
    const list = unitsByProposal.get(u.proposal_id) ?? [];
    list.push({
      name: titleByItem.get(u.curriculum_item_id) ?? '',
      komaCount: u.koma_count ?? 0,
      appliedKoma: u.applied_koma,
      groupId: u.group_id ?? 0,
      appliedGroupId: u.applied_group_id ?? 0,
      sortOrder: u.sort_order ?? 0,
      reason: u.reason ?? '',
    });
    unitsByProposal.set(u.proposal_id, list);
  }

  return proposals.map(
    (p): PlanProposalDetail => ({
      id: p.id,
      subject:
        p.textbook_id != null
          ? (subjectLabelByTextbook.get(p.textbook_id) ?? '科目不明')
          : '科目不明',
      textbookName: p.textbook_id != null ? (nameByTextbook.get(p.textbook_id) ?? '') : '',
      status: p.status === 'approved' || p.status === 'sent' ? p.status : 'draft',
      theme: p.theme ?? '',
      appliedKoma: p.applied_koma,
      units: (unitsByProposal.get(p.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    })
  );
}
