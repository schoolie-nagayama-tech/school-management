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
import { groupProposalsForPrint, type PrintSheetBlock } from './printSheetGrouping';

/**
 * 表示用の書名。科目が分かるなら「科目 書名」にする。
 *
 * 科目は引数で受け取る（`textbook.subject` を直に見ない）。過去問のように教材の科目が
 * 空の教材では、単元から解決した科目を付けて「英語 都立入試過去問」と出したいため。
 */
export function printTextbookName(proposal: SeasonalProposalWithDetails, subject: string): string {
  const name = proposal.textbook?.name ?? '';
  return subject ? `${subject} ${name}` : name;
}

/** 紙に載る1ブロック（提案書 × 科目）→ 紙に載せる1冊ぶん */
export function buildPrintBook(
  block: PrintSheetBlock,
  progressMap: PrintBook['progressMap']
): PrintBook {
  // その科目の単元だけを載せる。過去問の提案書は英語の紙にも数学の紙にも出るが、
  // どちらにも全コマを出すと保護者が2枚を足したときコマ数が倍に見える。
  const itemIds = new Set(block.items.map((item) => item.id));
  const activeUnits: PrintUnitDraft[] = block.proposal.units
    .filter((u) => u.koma_count > 0 && itemIds.has(u.curriculum_item_id))
    .map((u) => ({
      curriculum_item_id: u.curriculum_item_id,
      koma_count: u.koma_count,
      applied_koma: u.applied_koma ?? 0,
      reason: u.reason,
      group_id: u.group_id,
      intent_tag: u.intent_tag ?? null,
    }));

  return {
    textbookName: printTextbookName(block.proposal, block.subject),
    theme: block.proposal.theme ?? '',
    allItems: block.items,
    activeUnits,
    progressMap,
    // 合計コマもその科目の単元だけで数える（紙に出ているコマ数と一致させる）
    totalKoma: calcTotalKoma(activeUnits),
  };
}

/**
 * 提案書の配列 → 印刷する紙の配列。
 *
 * 単元と進捗の取得は提案書ごとに独立なので並列で取る
 * （逐次 await だと提案書の件数に比例して待ち時間が伸びる）。
 * 単元の科目を見てから紙を分けるので、取得はまとめる前に行う。
 */
export async function buildPrintSheets(
  proposals: SeasonalProposalWithDetails[],
  studentName: string
): Promise<ProposalPrintData[]> {
  const loaded = await Promise.all(
    proposals.map((p) => getTextbookUnitsWithProgress(p.student_textbook_id ?? null, p.textbook_id))
  );
  const progressByProposalId = new Map(proposals.map((p, i) => [p.id, loaded[i].progressMap]));

  const sheets = groupProposalsForPrint(
    proposals.map((proposal, i) => ({ proposal, items: loaded[i].items }))
  );

  return sheets.map((sheet) => ({
    studentName,
    seasonLabel: SEASON_LABELS[sheet.season as SeasonType] ?? sheet.season,
    year: sheet.year,
    subject: sheet.subject,
    books: sheet.blocks.map((block) =>
      buildPrintBook(block, progressByProposalId.get(block.proposal.id) ?? new Map())
    ),
  }));
}
