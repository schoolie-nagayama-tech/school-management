/**
 * 文章を「整える」共通の土台。
 *
 * 正典: docs/ai-features-integration-plan.md
 *
 * ★全文生成はしない（2026-09-02 決定）。AIに書かせるとAIっぽい文になり、
 *   教室長が書いた言い回しが消える。内容は人が決め、AIは整えるだけにする。
 *
 * ★行を増やさない・減らさない・順番を変えない、を「お願い」ではなく形で守る。
 *   本文を行に割ってから渡し、同じ番号の行を返させる。番号が合わないものは捨てる。
 *   プロンプトで頼むだけだと、箇条書きが勝手に3行にまとめられる事故を止められない。
 *
 * ★直した箇所を全部出す。整えた文をそのまま信じさせない。
 *   行ごとに比べれば「どこが変わったか」は機械的に出せるので、AIに申告させない。
 *
 * HTMLはここでは扱わない。呼び出し側（ブラウザ）が本文を行に割り、
 * 戻ってきた行を元のHTMLに差し戻す。★サーバーでHTMLを解析しない
 * （Vercelのランタイムで jsdom が動かず、本番全ページが500になった事故がある）。
 */

/** 整える対象の種類。面が増えたらここに足す */
export type RefineKind = 'bulletin' | 'proposal_theme';

/** 1行ぶん。index は元の並び順で、AIはこれを変えられない */
export interface RefineLine {
  index: number;
  text: string;
}

export interface RefineChange {
  index: number;
  before: string;
  after: string;
}

export interface RefineResult {
  lines: RefineLine[];
  changes: RefineChange[];
}

/** 1回に整える行数の上限。掲示板の投稿は実データで最長821字なので十分足りる */
export const MAX_LINES = 60;
/** 1行の上限。これを超える行は元のまま返す（そこだけ整えないほうが安全） */
export const MAX_LINE_LENGTH = 600;

/**
 * どの種類でも共通の決まり。
 * ★「事実を足さない」が最重要。日付や金額を作られると、読んだ講師がそれを信じる。
 */
const COMMON_RULES = [
  '守ること:',
  '- ★書かれていないことを足さない。日付・時刻・金額・人数・場所・人名を作らない。',
  '- ★書かれていることを削らない。要約しない。',
  '- 行を増やさない、減らさない、順番を変えない。渡された行と同じ番号で返す。',
  '- 直すのは、言い回し・助詞・表記ゆれ・誤字・敬体の揺れだけ。',
  '- 直すところが無い行は、そのまま返す。無理に変えない。',
  '- 記号や番号（・ 1. ① など）が行頭にあれば、そのまま残す。',
];

const KIND_RULES: Record<RefineKind, string[]> = {
  proposal_theme: [
    'これは学習塾の講習提案書の「講習テーマ」で、保護者が読みます。',
    '- ★1行のまま。改行しない。長さも大きく変えない。',
    '- ★中身を変えない。やる単元も、戻るのか進むのかも変えない。言い回しだけ直す。',
    '- 「ぜひ」「おすすめです」のような売り文句を足さない。',
  ],
  bulletin: [
    'これは学習塾の教室長が、教室の講師に向けて書いた連絡です。',
    '- 読む相手は社内の講師。ですます調のまま、事務連絡として読みやすくする。',
    '- ★丁寧にしすぎない。「お忙しいところ恐れ入りますが」のような前置きを足さない。',
    '- 箇条書きは箇条書きのまま。文章にまとめない。',
  ],
};

export function refineSystemPrompt(kind: RefineKind): string {
  return [
    'あなたは文章を整える校正者です。書き手ではありません。',
    '',
    ...KIND_RULES[kind],
    '',
    ...COMMON_RULES,
    '',
    '出力はJSONだけ。前置きは書かない:',
    '{"lines":[{"index":0,"text":"整えた行"},{"index":1,"text":"整えた行"}]}',
  ].join('\n');
}

export function refineUserText(lines: readonly RefineLine[]): string {
  return [
    '【整える文章】各行の先頭の番号は、返すときも同じ番号を使ってください。',
    '',
    ...lines.map((l) => `${l.index}: ${l.text}`),
  ].join('\n');
}

/**
 * 本文を行に割る。空行は送らない（整える対象が無く、番号だけ増える）。
 * ★元の位置は index で持つので、空行を飛ばしても差し戻しはできる。
 */
export function toRefineLines(rawLines: readonly string[]): RefineLine[] {
  const lines: RefineLine[] = [];
  for (let i = 0; i < rawLines.length && lines.length < MAX_LINES; i += 1) {
    const text = rawLines[i];
    if (!text || !text.trim()) continue;
    if (text.length > MAX_LINE_LENGTH) continue;
    lines.push({ index: i, text });
  }
  return lines;
}

/**
 * AIの生の出力を、使ってよい形にする。
 *
 * ★渡した行に無い番号は捨てる。★返ってこなかった行は元のまま残す。
 *   どちらも「勝手に増やす・消す」を止めるためで、AIの申告を信じない。
 */
export function parseRefineResult(raw: unknown, sent: readonly RefineLine[]): RefineResult {
  const byIndex = new Map(sent.map((l) => [l.index, l.text]));
  const result = new Map<number, string>(byIndex);

  const rows =
    raw && typeof raw === 'object' && Array.isArray((raw as { lines?: unknown }).lines)
      ? ((raw as { lines: unknown[] }).lines as unknown[])
      : [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as { index?: unknown; text?: unknown };
    if (typeof r.index !== 'number' || !Number.isInteger(r.index)) continue;
    // ★渡していない番号は捨てる（行を増やされない）
    if (!byIndex.has(r.index)) continue;
    if (typeof r.text !== 'string') continue;

    const text = r.text.trim();
    // 空にされたら元のまま（消させない）
    if (!text) continue;
    if (text.length > MAX_LINE_LENGTH) continue;

    result.set(r.index, text);
  }

  const lines = sent.map((l) => ({ index: l.index, text: result.get(l.index) ?? l.text }));
  // ★変わった行は機械的に出す。AIに「どこを直したか」を申告させない
  const changes: RefineChange[] = [];
  for (const l of lines) {
    const before = byIndex.get(l.index) ?? '';
    if (before !== l.text) changes.push({ index: l.index, before, after: l.text });
  }

  return { lines, changes };
}
