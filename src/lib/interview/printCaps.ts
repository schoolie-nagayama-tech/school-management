/**
 * 面談シート（印刷・A4縦1枚）の件数の上限。
 * ------------------------------------------------------------------
 * ★紙は1枚に固定した（globals.css の .interview-report-print-page が 190mm×276mm・はみ出しは切る）。
 *   中身は生徒ごとに長さが違う（AIの見えること・引継ぎ・前回の要望・想定問答・志望校）ので、
 *   「たまたま収まった」ではなく、どの生徒でも1枚に収まるよう件数をここで先に絞る。
 *   それでも溢れたぶんは、シーンごとの高さの上限（InterviewPrintSheet の max-h）で切る。
 *
 * ★削る順の考え方: 事実の一覧より、話す行・聞く行を残す。
 *   事実（成績・進行表・引継ぎ・前回の要望）は画面の「材料（記録）」に全部あるので、紙では頭の数件で足りる。
 *   話す・聞く行は面談中に紙を見ながら読むもので、切れると面談が止まる。
 *   ①⑥⑦の定型（数行・長さが変わらない）は絞らない。
 *
 * 削った件数は「ほか N件」として残す（黙って消すと、紙に無い＝記録が無いと読まれる）。
 */

export const INTERVIEW_PRINT_CAPS = {
  /** ③「なぜ今か」の定型トーク。季節によっては10行近くあり、1枚を超える主因だった */
  timing: 4,
  /** ③の想定問答。答えは2行で切る（全文は画面の③で読む） */
  qa: 3,
  /** ②「前回の要望・方針」（面談記録の行）。事実なので少なめ */
  previousRequests: 3,
  /** ②「前回の約束」（未完了タスク） */
  previousPromises: 3,
  /** ②振り返りの「報告する・聞く」行（前回の要望への対応）。1行が2行に折れやすいので件数は事実と同じ */
  followUps: 3,
  /** ②④⑤の事実のセクション（成績・進行表・引継ぎなど）1つあたりの行数。さらに2行で切る */
  sectionLines: 4,
  /** ④志望校（1校1行） */
  targetSchools: 3,
  /** ④直近の模試の合格可能性 */
  mockSchoolLines: 2,
  /** ④志望校について話すこと */
  targetSchoolTalk: 4,
  /** ⑤「なぜこの教科・単元か」（③と同じ定型の要約） */
  planRationale: 2,
} as const;

/** 先頭から max 件だけ残し、残りの件数を返す。★並びは呼び出し側の優先順（先頭ほど大事） */
export function capItems<T>(items: readonly T[], max: number): { shown: T[]; hidden: number } {
  const limit = Math.max(0, Math.floor(max));
  return {
    shown: items.slice(0, limit),
    hidden: Math.max(0, items.length - limit),
  };
}

/**
 * 「／」で1行につなぐ事実の行を max 件に絞り、削ったぶんを「ほかN件」として末尾に足す。
 * ★「ほかN件」は、画面の「材料（記録）」に続きがあると分かるようにするため。
 */
export function capLinesWithRest(lines: readonly string[], max: number): string[] {
  const { shown, hidden } = capItems(lines, max);
  return hidden > 0 ? [...shown, `ほか${hidden}件`] : shown;
}
