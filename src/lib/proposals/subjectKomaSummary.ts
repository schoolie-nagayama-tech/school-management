// 生徒別の提案書一覧の上に出す「科目ごとのコマ数」を数える純粋ロジック。
//
// ★科目は教材ではなく単元で決める（resolveUnitSubject）。過去問は1冊に全科目が載るので、
//   教材の科目で数えると全部「その他」に落ちる。テンプレでは「数学のテキスト＋過去問の数学」が
//   1つのパックとして入るので、過去問のコマもその科目に足したほうが、ひとまとまりで見やすい。
//   印刷の紙を科目で分けるとき（printSheetGrouping.ts）と同じ判定にそろえてある。
//
// ★結合（group_id）は1コマとして数える（calcTotalKoma と同じ）。結合が科目をまたいだときは、
//   先に出てきた単元の科目に数える。科目ごとの数を足すと合計に一致させるため
//   （科目ごとに calcTotalKoma をかけると、またいだ結合が2回数えられる）。
import { isAllSubjectTextbook, resolveUnitSubject } from '@/lib/curriculum/subject';
import type { SeasonalProposalWithDetails } from '@/types/database';

/** 科目が決められない単元の置き場所。従来の表示に合わせる */
export const UNKNOWN_SUBJECT = 'その他';

// ★過去問から振り分けた分の内訳は出さない（パックとして1つの数で見たいという要望）
export interface SubjectKoma {
  subject: string;
  koma: number;
}

export interface SubjectKomaSummary {
  subjects: SubjectKoma[];
  total: number;
}

/**
 * @param unitSubjectByItemId 単元ID → 単元の科目。過去問の単元だけ引けていればよい
 *   （それ以外の教材は単元の科目が空なので、教材の科目にそのまま落ちる）。
 */
export function summarizeKomaBySubject(
  proposals: Pick<SeasonalProposalWithDetails, 'units' | 'textbook'>[],
  unitSubjectByItemId: ReadonlyMap<number, string | null>
): SubjectKomaSummary {
  const bySubject = new Map<string, SubjectKoma>();
  let total = 0;

  for (const p of proposals) {
    const textbookSubject = p.textbook?.subject ?? null;
    const seenGroups = new Set<number>();

    for (const u of p.units) {
      if (u.group_id !== 0) {
        if (seenGroups.has(u.group_id)) continue;
        seenGroups.add(u.group_id);
      }
      if (u.koma_count <= 0) continue;

      const subject =
        resolveUnitSubject(unitSubjectByItemId.get(u.curriculum_item_id), textbookSubject) ||
        UNKNOWN_SUBJECT;
      const entry = bySubject.get(subject) ?? { subject, koma: 0 };
      entry.koma += u.koma_count;
      bySubject.set(subject, entry);
      total += u.koma_count;
    }
  }

  // 科目名順。「その他」は最後（振り分けられなかった残りなので、主役の科目の後ろに置く）
  const subjects = Array.from(bySubject.values()).sort((a, b) => {
    if (a.subject === UNKNOWN_SUBJECT) return 1;
    if (b.subject === UNKNOWN_SUBJECT) return -1;
    return a.subject.localeCompare(b.subject, 'ja');
  });
  return { subjects, total };
}

/** 単元の科目を引く必要がある単元ID（過去問の提案書の単元だけ） */
export function itemIdsNeedingSubject(
  proposals: Pick<SeasonalProposalWithDetails, 'units' | 'textbook'>[]
): number[] {
  const ids = new Set<number>();
  for (const p of proposals) {
    if (!isAllSubjectTextbook(p.textbook?.subject)) continue;
    for (const u of p.units) ids.add(u.curriculum_item_id);
  }
  return Array.from(ids);
}
