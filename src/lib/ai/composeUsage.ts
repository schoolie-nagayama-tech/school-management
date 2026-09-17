/**
 * おまかせ下書きが「使われたか」を、操作の結果から判定する。
 *
 * 正典: docs/ai-features-integration-plan.md
 *
 * ★ボタンを増やさない。「役に立ちましたか？」を投稿画面に足しても、
 *   教室長は投稿を出したいだけなので押さない。押されないボタンから取れる数はゼロで、
 *   画面だけ重くなる。ここで見ているのは「AIが出した下書き」と「実際に投稿した本文」の差で、
 *   これは投稿という本来の操作から機械的に取れる。
 *
 * ★厳密な差分は取らない。知りたいのは「そのまま出せたのか、直したのか、捨てたのか」の3つで、
 *   何文字直したかではない。行の集合が一致するかと、AIの行が1行でも残っているかで足りる。
 *
 * ★比べる前に空白を落とす。リッチテキストのエディタは全角空白や &nbsp; を勝手に入れ替えるので、
 *   人が1文字も触っていなくても文字列としては変わる。空白の違いで「直した」と数えると、
 *   'used_as_is' がほぼ0件になり、いちばん知りたい数が取れなくなる。
 */

/** この判定で出る答え。★feedback.ts の ai_compose の一覧と同じ3つ */
export type ComposeUsageVerdict = 'used_as_is' | 'edited' | 'discarded';

export interface ComposeUsage {
  verdict: ComposeUsageVerdict;
  /** AIが出した行のうち、最終の本文にそのまま残っていた行数 */
  kept: number;
}

/**
 * 空白を全部落として比べる形にする。
 * 半角・全角スペース、改行、タブ、&nbsp;（U+00A0）をまとめて落とす。
 */
function normalize(line: string): string {
  return line.replace(/[\s　 ]/g, '');
}

function normalizeLines(lines: readonly string[]): string[] {
  return lines.map(normalize).filter((t) => t.length > 0);
}

/**
 * AIが出した行と、最終の本文の行から、使われ方を判定する。
 *
 * @param aiLines   AIが最後に出した下書きの行（htmlToLines の text）
 * @param finalLines 投稿した本文の行（同上）
 */
export function judgeComposeUsage(
  aiLines: readonly string[],
  finalLines: readonly string[]
): ComposeUsage {
  const ai = normalizeLines(aiLines);
  const final = normalizeLines(finalLines);

  // 本文が空（＝投稿できないはずだが、念のため）。AIのものは何も残っていない
  if (final.length === 0) return { verdict: 'discarded', kept: 0 };

  // ★AIが1行も出していないときは答え合わせにならない。
  //   呼ぶ側（投稿画面）は下書きが無ければ呼ばないが、ここでも捨て扱いにして黙って返す。
  if (ai.length === 0) return { verdict: 'discarded', kept: 0 };

  const finalSet = new Set(final);
  const kept = ai.filter((t) => finalSet.has(t)).length;

  // AIの行が1行も残っていない＝下書きは捨てて書き直した
  if (kept === 0) return { verdict: 'discarded', kept: 0 };

  // 行の並びまで含めて同じなら、手を入れずにそのまま出した
  const same = ai.length === final.length && ai.every((t, i) => t === final[i]);
  return { verdict: same ? 'used_as_is' : 'edited', kept };
}
