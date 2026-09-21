// 提案書の配列を「保護者に渡す紙」の単位にまとめる純粋ロジック。
//
// なぜまとめるのか:
//   同じ科目を3冊続けてやる（1冊目→2冊目→3冊目）というのが講習の中身なので、
//   目的が1つなら紙も1枚にする。提案書のDB上の件数（テキスト1冊＝1件）と、
//   保護者に見せる紙の枚数は別物でよい。
//
// ★DBに「グループ」列は足さない。まとめる条件は
//   生徒 × season × year × 科目 だけで決まり、テンプレートを適用して出来た複数冊も、
//   3冊選んで新規作成した提案書も、同じ規則で自然に1枚になる。
import type { SeasonalProposalWithDetails } from '@/types/database';

/** 紙1枚ぶん。proposals は進める順（created_at 昇順）に並ぶ */
export interface PrintSheetGroup {
  key: string;
  /** 科目。空文字＝科目未設定（まとめずに単独で1枚） */
  subject: string;
  season: string;
  year: number;
  proposals: SeasonalProposalWithDetails[];
}

/** 並べ替えに使う書名（科目が同じ紙同士の順番を安定させる） */
function textbookNameOf(p: SeasonalProposalWithDetails): string {
  return p.textbook?.name ?? '';
}

function subjectOf(p: SeasonalProposalWithDetails): string {
  return p.textbook?.subject ?? '';
}

/** created_at 昇順。未設定は先頭に寄せる（順番が決められないものを後ろに落とさない） */
function byCreatedAt(a: SeasonalProposalWithDetails, b: SeasonalProposalWithDetails): number {
  const ca = a.created_at ?? '';
  const cb = b.created_at ?? '';
  if (ca === cb) return 0;
  return ca < cb ? -1 : 1;
}

/**
 * 提案書 → 紙（複数冊を束ねたもの）。
 *
 * - まとめる単位は 生徒 × season × year × 科目。科目が空の提案書はまとめず単独で1枚。
 * - 束の中の並びは created_at 昇順＝作った順＝上から進める順。
 * - 紙同士の並びは従来どおり科目順（同じ科目なら先頭の書名順）。
 */
export function groupProposalsForPrint(
  proposals: SeasonalProposalWithDetails[]
): PrintSheetGroup[] {
  const groups = new Map<string, PrintSheetGroup>();

  proposals.forEach((p, index) => {
    const subject = subjectOf(p);
    // 科目が無いものは束ねようがないので、index を混ぜて必ず単独の紙にする
    const key = subject
      ? `${p.student_id}|${p.season}|${p.year}|${subject}`
      : `solo|${p.id}|${index}`;
    const found = groups.get(key);
    if (found) {
      found.proposals.push(p);
    } else {
      groups.set(key, {
        key,
        subject,
        season: p.season,
        year: p.year,
        proposals: [p],
      });
    }
  });

  const sheets = Array.from(groups.values());
  for (const sheet of sheets) {
    sheet.proposals.sort(byCreatedAt);
  }

  return sheets.sort((a, b) => {
    if (a.subject !== b.subject) return a.subject.localeCompare(b.subject, 'ja');
    return textbookNameOf(a.proposals[0]).localeCompare(textbookNameOf(b.proposals[0]), 'ja');
  });
}
