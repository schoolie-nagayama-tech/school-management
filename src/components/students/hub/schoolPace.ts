/**
 * 生徒ハブの進行表「学校進度との比較」。画面から切り離した純粋関数。
 *
 * 通常のテキストごとに、学校の到達単元と当塾の到達単元を出し、差を単元の数で返す。
 *
 * ★比較は必ず「最深到達点どうし」で行う。単元ごとに「学校の日付が付いているのに未指導か」を見ると、
 *   まだ習っていない先の単元（正常な進度差）まで拾って誤検知が大量に出る。以前のスマートアラート
 *  （lib/api/progress-sessions.ts の getSmartAlerts）はこれで無効化された。ここではテキストごとに
 *   学校の最深部1点と当塾の最深部1点だけを比べ、1冊につき1行しか出さない。
 * ★school_progress_date は手入力で、学校の予定として先の日付を入れておける。
 *   「到達済み」は school_progress_date <= 今日 だけで判定し、未来の日付は無視する。
 * ★当塾の到達単元は「今の状態」（hubStatus.ts の reachedUnitTitle）と同じ定義:
 *   授業日（lesson_date）の入った授業が1件でもある単元のうち、並び（sort_order）で最も先のもの。
 *   定義がずれると、上の「今の状態」と下の比較表で到達単元が食い違う。
 * ★講習のテキスト（季節の印あり）は比べない。講習は学校の進度と関係なく進むため。
 */
import type { TextbookProgressData } from '@/app/interview/ProgressPanel';
import { SUBJECT_LABELS } from '@/types/database';
import { splitBySeason } from './hubStatus';

type Row = TextbookProgressData['rows'][number];

/** 学校と比べた当塾の位置。遅れ＝当塾が学校より手前 */
export type SchoolPaceStatus = 'behind' | 'same' | 'ahead';

/** 比べられたテキスト */
export interface SchoolPaceCompared {
  kind: 'compared';
  /** student_textbooks.id */
  textbookId: string;
  /** 「数学 新中問 数学2」 */
  label: string;
  /** 学校が到達した単元 */
  schoolUnit: string;
  /** 当塾が到達した単元。まだ1回も授業をしていなければ null */
  jukuUnit: string | null;
  /**
   * 当塾 − 学校 の単元の数。負なら遅れ、0 なら同じ、正なら先。
   * ★sort_order の差ではなく、並べたときの位置の差（間にある単元の数）。sort_order は飛び番があり得るため。
   */
  diff: number;
  status: SchoolPaceStatus;
}

/**
 * 学校進度の記録が無いテキスト（今日以前の school_progress_date が1件も無い）。
 * 比べる相手が無いので、表には出さない。「同じ」と区別するために別の種類で返す。
 */
export interface SchoolPaceNoRecord {
  kind: 'no_school_record';
  textbookId: string;
  label: string;
}

export type SchoolPaceEntry = SchoolPaceCompared | SchoolPaceNoRecord;

/**
 * 単元を並び順に並べる。sort_order が無い行は取得順の位置で代用する（reachedUnitTitle と同じ）。
 * ★sort_order が同じ行は取得順を保つ（安定ソート）。reachedUnitTitle は同じ sort_order なら
 *   後ろの行を採るので、下の最深部探しも「位置が大きいほう」を採れば一致する。
 */
function orderedUnits(rows: readonly Row[]): Row[] {
  return rows
    .map((row, index) => ({ row, index, order: row.sort_order ?? index }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map((x) => x.row);
}

/** 条件に合う単元のうち、並びで最も先のものの位置（無ければ -1） */
function deepestIndex(units: readonly Row[], hit: (row: Row) => boolean): number {
  for (let i = units.length - 1; i >= 0; i--) {
    if (hit(units[i])) return i;
  }
  return -1;
}

/** 1回目の授業をした単元か（reachedUnitTitle・summarizeTextbookProgress の done と同じ判定） */
function isTaught(row: Row): boolean {
  return (row.progress?.lessons ?? []).some((l) => l.lesson_date);
}

function textbookLabel(data: TextbookProgressData): string {
  const name = data.textbook.textbook?.name ?? '（不明な教材）';
  const subjectCode = data.textbook.textbook?.subject ?? '';
  const subject = SUBJECT_LABELS[subjectCode] ?? subjectCode;
  return subject ? `${subject} ${name}` : name;
}

/**
 * 通常のテキストごとに学校進度と比べる。並びは渡された順（講習を外しただけ）。
 *
 * @param today 'YYYY-MM-DD'（ローカル日付）。これ以前の school_progress_date だけを到達済みとみなす
 */
export function computeSchoolPace(
  textbookData: readonly TextbookProgressData[],
  today: string
): SchoolPaceEntry[] {
  const { regular } = splitBySeason([...textbookData]);
  return regular.map((data): SchoolPaceEntry => {
    const label = textbookLabel(data);
    const units = orderedUnits(data.rows);
    const schoolIdx = deepestIndex(units, (row) => {
      const d = row.progress?.school_progress_date;
      // 日付は 'YYYY-MM-DD'。時刻付きで入っていても先頭10文字で比べる
      return !!d && d.slice(0, 10) <= today;
    });
    if (schoolIdx < 0) {
      return { kind: 'no_school_record', textbookId: data.textbook.id, label };
    }
    const jukuIdx = deepestIndex(units, isTaught);
    // 未着手（jukuIdx = -1）は「最初の単元の1つ手前」にいるとみなす。学校が1単元目なら1単元遅れ
    const diff = jukuIdx - schoolIdx;
    return {
      kind: 'compared',
      textbookId: data.textbook.id,
      label,
      schoolUnit: units[schoolIdx].title,
      jukuUnit: jukuIdx >= 0 ? units[jukuIdx].title : null,
      diff,
      status: diff < 0 ? 'behind' : diff > 0 ? 'ahead' : 'same',
    };
  });
}

/** 差の表記。「3単元 遅れ」「同じ」「2単元 先」 */
export function formatSchoolPaceDiff(diff: number): string {
  if (diff < 0) return `${-diff}単元 遅れ`;
  if (diff > 0) return `${diff}単元 先`;
  return '同じ';
}
