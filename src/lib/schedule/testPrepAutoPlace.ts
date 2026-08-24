/**
 * テスト対策（増コマ）の自動配置：どのコマに・どの講師で入れるかを決める（純関数）
 *
 * ★ ここが決めるのは「提案」であって確定ではない。
 *   結果は画面に一覧で出し、室長が見てから確定する。だから凝ったアルゴリズムより
 *   「なぜその日・その講師になったか」が説明できることを優先する。
 *   （講習の自動割り当ては最小費用流を使うが、あちらは全生徒×全コマの大規模割当。
 *     こちらは1生徒×1科目×数コマなので、規則が読めるほうが手直ししやすい）
 *
 * 決めごと:
 *   1. 日付の早い順に置く。テスト前に間に合わせたいので後ろへ寄せない。
 *   2. まず1日1コマずつ散らす。同じ日に固めると生徒の負担が偏り、欠席時に丸ごと飛ぶ。
 *      必要数が空き日数を超えたときだけ、2巡目として同じ日の別コマを使う。
 *   3. 講師は候補の中で priority が大きいものを採る（＝いつもの担当を優先）。
 *      同点なら「そのコマで抱えている生徒が少ない講師」を採って偏りを避ける。
 */

/** 配置できる1マス。teachers は checkTeacherFit を通した候補だけを入れておくこと。 */
export interface AutoPlaceCell {
  date: string;
  slotId: string;
  /** 表示用のコマ番号（提案一覧に「3限」と出す） */
  slotNumber: number;
  teachers: AutoPlaceTeacher[];
}

export interface AutoPlaceTeacher {
  id: string;
  name: string;
  /** 大きいほど優先。いつもこの生徒のこの科目を見ている講師に加点する */
  priority: number;
  /** そのコマで既に抱えている生徒数。priority 同点のときの振り分けに使う */
  load: number;
}

/** 提案1件。 */
export interface AutoPlacePick {
  date: string;
  slotId: string;
  slotNumber: number;
  teacherId: string;
  teacherName: string;
}

export interface AutoPlaceResult {
  picks: AutoPlacePick[];
  /** 置ききれなかった数。0 でなければ画面で必ず伝える（黙って少なく置かない） */
  shortfall: number;
}

/** そのマスで最良の講師を選ぶ。priority 降順 → load 昇順 → id 昇順（結果を安定させる）。 */
function bestTeacher(teachers: AutoPlaceTeacher[]): AutoPlaceTeacher | null {
  if (teachers.length === 0) return null;
  return [...teachers].sort(
    (a, b) => b.priority - a.priority || a.load - b.load || a.id.localeCompare(b.id)
  )[0];
}

/**
 * 必要コマ数ぶんの提案を作る。
 * cells は呼び出し側で「配置可能なマスだけ」に絞ってから渡すこと（休講日・過去日・重複は除外済み）。
 */
export function pickTestPrepPlacements(cells: AutoPlaceCell[], needed: number): AutoPlaceResult {
  if (needed <= 0) return { picks: [], shortfall: 0 };

  // 日付昇順 → コマ番号昇順。同じ日なら早いコマから使う。
  const sorted = [...cells]
    .filter((c) => c.teachers.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.slotNumber - b.slotNumber);

  const picks: AutoPlacePick[] = [];
  const usedDates = new Set<string>();
  const usedCells = new Set<string>();
  /** 提案の中で講師が持つことになる件数。同じ提案内で1人に寄せないための加算。 */
  const extraLoad = new Map<string, number>();

  const take = (cell: AutoPlaceCell): boolean => {
    const cellKey = `${cell.date}|${cell.slotId}`;
    if (usedCells.has(cellKey)) return false;
    // 同じ提案の中で既に埋まった枠ぶんを load に足して選ぶ（1人に固まらせない）
    const withLoad = cell.teachers.map((t) => ({
      ...t,
      load: t.load + (extraLoad.get(t.id) ?? 0),
    }));
    const teacher = bestTeacher(withLoad);
    if (!teacher) return false;
    picks.push({
      date: cell.date,
      slotId: cell.slotId,
      slotNumber: cell.slotNumber,
      teacherId: teacher.id,
      teacherName: teacher.name,
    });
    usedCells.add(cellKey);
    usedDates.add(cell.date);
    extraLoad.set(teacher.id, (extraLoad.get(teacher.id) ?? 0) + 1);
    return true;
  };

  // 1巡目: 1日1コマずつ散らす
  for (const cell of sorted) {
    if (picks.length >= needed) break;
    if (usedDates.has(cell.date)) continue;
    take(cell);
  }

  // 2巡目以降: 足りなければ同じ日の別コマも使う
  while (picks.length < needed) {
    const before = picks.length;
    for (const cell of sorted) {
      if (picks.length >= needed) break;
      take(cell);
    }
    // 1周して1件も増えなければ、もう置ける枠が無い
    if (picks.length === before) break;
  }

  return { picks, shortfall: Math.max(0, needed - picks.length) };
}
