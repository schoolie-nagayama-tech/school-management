// 提案書の配列から「印刷する紙」の配列を作る。
//
// 生徒別の提案書一覧（ProposalList）と教室全体の一覧（/courses/proposals）に
// ほぼ同じ組み立てが重複していたので1本にまとめた。まとめる規則（どれを1枚にするか）は
// printSheetGrouping.ts の純関数に分けてあり、ここは取得と整形だけを担当する。
import { calcTotalKoma, getTextbookUnitsWithProgress } from '@/lib/api/proposals';
import type {
  PrintBook,
  PrintUnitDraft,
  ProposalPrintData,
} from '@/components/proposals/ProposalPrintView';
import type { SeasonalProposalWithDetails, SeasonType } from '@/types/database';
import { SEASON_LABELS } from '@/types/database';
import { groupProposalsForPrint } from './printSheetGrouping';

/** 表示用の書名。科目が分かるなら「科目 書名」にする（従来の組み立てと同じ） */
export function printTextbookName(p: SeasonalProposalWithDetails): string {
  return p.textbook?.subject
    ? `${p.textbook.subject} ${p.textbook.name}`
    : (p.textbook?.name ?? '');
}

/** 保存済みの提案書1件 → 紙に載せる1冊ぶん */
export function buildPrintBook(
  proposal: SeasonalProposalWithDetails,
  items: PrintBook['allItems'],
  progressMap: PrintBook['progressMap']
): PrintBook {
  const activeUnits: PrintUnitDraft[] = proposal.units
    .filter((u) => u.koma_count > 0)
    .map((u) => ({
      curriculum_item_id: u.curriculum_item_id,
      koma_count: u.koma_count,
      applied_koma: u.applied_koma ?? 0,
      reason: u.reason,
      group_id: u.group_id,
      intent_tag: u.intent_tag ?? null,
    }));

  return {
    textbookName: printTextbookName(proposal),
    theme: proposal.theme ?? '',
    allItems: items,
    activeUnits,
    progressMap,
    totalKoma: calcTotalKoma(proposal.units),
  };
}

/**
 * 提案書の配列 → 印刷する紙の配列。
 *
 * 単元と進捗の取得は提案書ごとに独立なので並列で取る
 * （逐次 await だと提案書の件数に比例して待ち時間が伸びる）。
 */
export async function buildPrintSheets(
  proposals: SeasonalProposalWithDetails[],
  studentName: string
): Promise<ProposalPrintData[]> {
  const sheets = groupProposalsForPrint(proposals);
  // 紙をまたいで1本の配列にしてから並列取得し、あとで紙ごとに切り戻す
  const flat = sheets.flatMap((sheet) => sheet.proposals);
  const loaded = await Promise.all(
    flat.map((p) => getTextbookUnitsWithProgress(p.student_textbook_id ?? null, p.textbook_id))
  );
  const byProposalId = new Map(flat.map((p, i) => [p.id, loaded[i]]));

  return sheets.map((sheet) => ({
    studentName,
    seasonLabel: SEASON_LABELS[sheet.season as SeasonType] ?? sheet.season,
    year: sheet.year,
    subject: sheet.subject,
    books: sheet.proposals.map((p) => {
      const entry = byProposalId.get(p.id);
      return buildPrintBook(p, entry?.items ?? [], entry?.progressMap ?? new Map());
    }),
  }));
}
