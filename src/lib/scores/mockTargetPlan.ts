/**
 * 模試の志望校を、生徒の志望校（student_target_schools）にどう反映するかを決める（純関数）。
 * ------------------------------------------------------------------
 * 教室長（2026-09-28）:
 *   「志望校は結構変わるからほんとは上書きしたいんだけど、無言で書き換えられるのも困る」
 *   「私立も取り込んでほしいんだけど、併願かどうかは結局人が判断になる」
 *   「5行までにしよう。私立第一志望もいるからね」
 *
 * ■ 決まり
 *   - 模試の5枠（1〜3公立・4〜5私立）を枠の順に詰めて第1〜第5志望にする。
 *   - 取り込み画面で生徒ごとに「新規／差し替え／同じ」と、行ごとの前後を見せてから反映する（黙って書き換えない）。
 *   - 差し替えは既定で反映する。ただし、いまの志望校に「模試の月より後に手で入れた・直した行」があれば
 *     既定で外す（面談で聞いた最新の志望を、古い模試で消さないため）。チェックを入れれば反映できる。
 *   - 同じ学校が残る行は、併願の印と理由を引き継ぐ。消える学校の印と理由は消える。
 *   - 私立に併願の印は付けない（人が面談で決める）。
 *
 * 正典: docs/interview-workspace-layout-2026-09.md「模試の志望校」
 */
import { normalizeText } from '@/lib/ai/schoolLookup';

/** 志望校の行の上限（DBの rank 1〜5） */
export const MAX_TARGET_RANK = 5;

/** いま登録されている志望校1行 */
export interface CurrentTargetRow {
  rank: number;
  schoolName: string;
  highSchoolId: string | null;
  reason: string | null;
  isHeigan: boolean;
  /** 模試の取り込みで入った行ならその模試。手で入れた・直した行は null */
  sourceAssessmentId: string | null;
  updatedAt: string;
}

/** 模試の1枠（マスタに当てた後） */
export interface MockTargetPick {
  slot: number;
  /** マスタに当たればマスタの学校名、当たらなければ模試の名前を短くしたもの */
  schoolName: string;
  highSchoolId: string | null;
}

/** 反映後の志望校1行 */
export interface PlannedTargetRow {
  rank: number;
  schoolName: string;
  highSchoolId: string | null;
  reason: string | null;
  isHeigan: boolean;
}

export type TargetPlanKind =
  /** 志望校が空だった */
  | 'new'
  /** 模試と違う */
  | 'change'
  /** 模試と同じ（反映しても何も変わらない） */
  | 'same'
  /** 模試に志望校が書かれていない（触らない） */
  | 'none';

/** 画面に出す1行ぶんの前後 */
export interface TargetPlanLine {
  rank: number;
  before: string | null;
  after: string | null;
  changed: boolean;
}

export interface TargetPlan {
  kind: TargetPlanKind;
  rows: PlannedTargetRow[];
  lines: TargetPlanLine[];
  /** いまの志望校に、模試の月より後に手で入れた・直した行がある */
  manualAfterMock: boolean;
  /** 取り込み画面のチェックの既定 */
  defaultApply: boolean;
}

/** 同じ学校か。マスタに当たっていれば id で、どちらかが当たっていなければ名前で比べる */
export function isSameTargetSchool(
  a: { schoolName: string; highSchoolId: string | null },
  b: { schoolName: string; highSchoolId: string | null }
): boolean {
  if (a.highSchoolId && b.highSchoolId) return a.highSchoolId === b.highSchoolId;
  return normalizeText(a.schoolName).trim() === normalizeText(b.schoolName).trim();
}

/**
 * 模試の月（「2026-10」）の初日（日本時間）より後に、手で入れた・直した行があるか。
 * ★模試は月単位でしか持っていない（assessments.exam_month）。月の初日で比べるので、
 *   模試の数日前に手で入れた行も「後」に数えることがある。既定のチェックが外れるだけで、
 *   人がチェックを入れれば反映できるので、安全側（消さない側）に倒す。
 */
function hasManualEditAfter(
  current: readonly CurrentTargetRow[],
  examMonth: string | null
): boolean {
  if (!examMonth) return false;
  const since = new Date(`${examMonth}-01T00:00:00+09:00`).getTime();
  if (Number.isNaN(since)) return false;
  return current.some(
    (r) => r.sourceAssessmentId == null && new Date(r.updatedAt).getTime() >= since
  );
}

export function planTargetSchoolsFromMock(
  current: readonly CurrentTargetRow[],
  picks: readonly MockTargetPick[],
  examMonth: string | null
): TargetPlan {
  const sortedCurrent = [...current].sort((a, b) => a.rank - b.rank);
  const sortedPicks = [...picks]
    .filter((p) => p.schoolName.trim())
    .sort((a, b) => a.slot - b.slot)
    .slice(0, MAX_TARGET_RANK);

  const manualAfterMock = hasManualEditAfter(sortedCurrent, examMonth);

  if (sortedPicks.length === 0) {
    return { kind: 'none', rows: [], lines: [], manualAfterMock, defaultApply: false };
  }

  const rows: PlannedTargetRow[] = sortedPicks.map((p, i) => {
    // ★同じ学校が残るなら、面談で決めた併願の印と聞いた理由を引き継ぐ
    const kept = sortedCurrent.find((c) => isSameTargetSchool(c, p));
    return {
      rank: i + 1,
      schoolName: p.schoolName,
      highSchoolId: p.highSchoolId,
      reason: kept?.reason ?? null,
      isHeigan: kept?.isHeigan ?? false,
    };
  });

  // ★.at(-1) は使わない（tsconfig の target が ES2017。CLAUDE.md「言語の罠」）
  const maxRank = Math.max(rows.length, sortedCurrent[sortedCurrent.length - 1]?.rank ?? 0);
  const lines: TargetPlanLine[] = [];
  for (let rank = 1; rank <= maxRank; rank++) {
    const before = sortedCurrent.find((c) => c.rank === rank) ?? null;
    const after = rows.find((r) => r.rank === rank) ?? null;
    if (!before && !after) continue;
    const changed = !before || !after || !isSameTargetSchool(before, after);
    lines.push({
      rank,
      before: before?.schoolName ?? null,
      after: after?.schoolName ?? null,
      changed,
    });
  }

  const kind: TargetPlanKind =
    sortedCurrent.length === 0 ? 'new' : lines.some((l) => l.changed) ? 'change' : 'same';
  const defaultApply = kind === 'new' || (kind === 'change' && !manualAfterMock);
  return { kind, rows, lines, manualAfterMock, defaultApply };
}
