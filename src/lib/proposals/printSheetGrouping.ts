// 提案書の配列を「保護者に渡す紙」の単位にまとめる純粋ロジック。
//
// なぜまとめるのか:
//   同じ科目を3冊続けてやる（1冊目→2冊目→3冊目）というのが講習の中身なので、
//   目的が1つなら紙も1枚にする。提案書のDB上の件数（テキスト1冊＝1件）と、
//   保護者に見せる紙の枚数は別物でよい。
//
// ★紙の1ブロックは「提案書1件」ではなく「(提案書, 単元の科目) の組」。
//   過去問は1冊に全科目が載るため、提案書1件が英語の単元・数学の単元…と複数科目を持つ。
//   その提案書は英語の紙にも数学の紙にも載るが、**載るのはその科目の単元とコマ数だけ**。
//   こうしないと両方の紙に全コマが出て、保護者が2枚を足すとコマ数が倍に見えてしまう。
//
// ★DBに「グループ」列は足さない。まとめる条件は
//   生徒 × season × year × 科目 だけで決まり、テンプレートを適用して出来た複数冊も、
//   3冊選んで新規作成した提案書も、同じ規則で自然に1枚になる。
import { resolveUnitSubject } from '@/lib/curriculum/subject';
import type { CurriculumItem, SeasonalProposalWithDetails } from '@/types/database';

/** まとめる前の入力。items はその教材の全単元（科目を引くのに要る） */
export interface PrintProposalSource {
  proposal: SeasonalProposalWithDetails;
  items: CurriculumItem[];
}

/** 紙に載る1ブロック＝(提案書, 科目)。items はその科目の単元だけに絞ってある */
export interface PrintSheetBlock {
  proposal: SeasonalProposalWithDetails;
  subject: string;
  items: CurriculumItem[];
}

/** 紙1枚ぶん。blocks は進める順（byPrintOrder）に並ぶ */
export interface PrintSheetGroup {
  key: string;
  /** 科目。空文字＝科目未設定（まとめずに単独で1枚） */
  subject: string;
  season: string;
  year: number;
  blocks: PrintSheetBlock[];
}

/** 並べ替えに使う書名（科目が同じ紙同士の順番を安定させる） */
function textbookNameOf(block: PrintSheetBlock): string {
  return block.proposal.textbook?.name ?? '';
}

/**
 * 過去問のように1冊で全科目を扱う教材か（教材の科目が空で、紙の科目は単元から引いたもの）。
 */
function isAllSubjectBook(block: PrintSheetBlock): boolean {
  return !block.proposal.textbook?.subject;
}

/**
 * 1枚の中の並び。科目のある教材を先に created_at 昇順、過去問など全科目の教材はその後ろ。
 *
 * ★created_at だけで並べてはいけない。過去問の提案書は (生徒, 教材, 期) で1件しか無く、
 *   英語のテンプレで作られたあと、数学のテンプレでは同じ1件に単元が足される（proposalMerge.ts）。
 *   created_at は英語で作った時刻のままなので、数学の紙では数学の教材より古く見え、
 *   テンプレでは最後に置いた過去問が1冊目に出ていた。
 *   足し込まれた科目で何番目に置かれたかはDBに残らないため、「全科目の教材は科目の教材の後」と決める
 *   （過去問は仕上げに使うもので、どの科目でも最後に置かれている）。
 */
function byPrintOrder(a: PrintSheetBlock, b: PrintSheetBlock): number {
  const allA = isAllSubjectBook(a);
  const allB = isAllSubjectBook(b);
  if (allA !== allB) return allA ? 1 : -1;
  const ca = a.proposal.created_at ?? '';
  const cb = b.proposal.created_at ?? '';
  if (ca === cb) return 0;
  return ca < cb ? -1 : 1;
}

/**
 * 提案書1件 → その提案書が持つ科目ごとのブロック。
 *
 * 科目は「提案コマが入っている単元」から拾う。教材の全単元から拾うと、
 * 過去問の提案書が1件あるだけで5科目ぶんの紙が生まれ、コマ0の紙が混ざるため。
 * 単元が1件も無い（あるいは全部0コマの）提案書は、従来どおり教材の科目で1ブロックにする。
 */
function blocksOfProposal(source: PrintProposalSource): PrintSheetBlock[] {
  const { proposal, items } = source;
  const textbookSubject = proposal.textbook?.subject ?? null;
  const subjectByItemId = new Map(
    items.map((item) => [item.id, resolveUnitSubject(item.subject, textbookSubject)])
  );

  // 科目の並びは単元の並び（sort_order）に従う。過去問は科目が先・年度が後で並べてあるので、
  // 紙の順番も「英語 → 数学 → …」と教材の目次どおりになる。
  const subjects: string[] = [];
  for (const item of items) {
    const used = proposal.units.some((u) => u.curriculum_item_id === item.id && u.koma_count > 0);
    if (!used) continue;
    const subject = subjectByItemId.get(item.id) ?? '';
    if (!subjects.includes(subject)) subjects.push(subject);
  }

  if (subjects.length === 0) {
    return [{ proposal, subject: resolveUnitSubject(null, textbookSubject), items }];
  }

  return subjects.map((subject) => ({
    proposal,
    subject,
    items: items.filter((item) => (subjectByItemId.get(item.id) ?? '') === subject),
  }));
}

/**
 * 提案書 → 紙（複数冊を束ねたもの）。
 *
 * - まとめる単位は 生徒 × season × year × 科目。科目が空のブロックはまとめず単独で1枚。
 * - 束の中の並びは作った順＝上から進める順。過去問など全科目の教材は後ろ（byPrintOrder）。
 * - 紙同士の並びは従来どおり科目順（同じ科目なら先頭の書名順）。
 */
export function groupProposalsForPrint(sources: PrintProposalSource[]): PrintSheetGroup[] {
  const groups = new Map<string, PrintSheetGroup>();

  sources.forEach((source, index) => {
    for (const block of blocksOfProposal(source)) {
      const { proposal, subject } = block;
      // 科目が無いものは束ねようがないので、index を混ぜて必ず単独の紙にする
      const key = subject
        ? `${proposal.student_id}|${proposal.season}|${proposal.year}|${subject}`
        : `solo|${proposal.id}|${index}`;
      const found = groups.get(key);
      if (found) {
        found.blocks.push(block);
      } else {
        groups.set(key, {
          key,
          subject,
          season: proposal.season,
          year: proposal.year,
          blocks: [block],
        });
      }
    }
  });

  const sheets = Array.from(groups.values());
  for (const sheet of sheets) {
    sheet.blocks.sort(byPrintOrder);
  }

  return sheets.sort((a, b) => {
    if (a.subject !== b.subject) return a.subject.localeCompare(b.subject, 'ja');
    return textbookNameOf(a.blocks[0]).localeCompare(textbookNameOf(b.blocks[0]), 'ja');
  });
}
