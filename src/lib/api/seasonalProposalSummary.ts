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

  const textbookIds = Array.from(
    new Set(proposals.map((p) => p.textbook_id).filter((id): id is number => id != null))
  );
  const { data: textbookRows } =
    textbookIds.length > 0
      ? await db.from('textbooks').select('id, subject, subject_id').in('id', textbookIds)
      : { data: [] };
  const textbooks = (textbookRows ?? []) as Array<{
    id: number;
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
      ? await db.from('subjects').select('id, name').in('id', missingSubjectIds)
      : { data: [] };
  const subjectNameById = new Map(
    ((subjectRows ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name])
  );

  const subjectLabelByTextbook = new Map<number, string>();
  for (const t of textbooks) {
    const label =
      t.subject?.trim() || (t.subject_id ? (subjectNameById.get(t.subject_id) ?? '') : '');
    subjectLabelByTextbook.set(t.id, label || '科目不明');
  }

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
