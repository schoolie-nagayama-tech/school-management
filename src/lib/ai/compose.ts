/**
 * 「おまかせ下書き」— 一言の指示から、そのまま出せる連絡文を書き切る。
 *
 * 正典: docs/ai-features-integration-plan.md
 *
 * ★空欄で逃げない。以前は「指示に無い事実は書かず [いつまで] と空けておく」設計にしていたが、
 *   教室長が実際に打つのは「PCS配布」の一言で、空欄だらけの骨組みが返るだけだった。
 *   埋めるのは結局その人で、埋め終わったときには投稿が書き上がっている。それでは乗せた意味がない。
 *
 * ★踏み込んでよい理由は、投稿ボタンを押すのが教室長だから。
 *   下書きは講師の目に触れない。読まれる前に必ず一度、書いた本人が読む。
 *   「講師が読む文だから嘘を書けない」は、投稿後の本文には効くが、下書きには効かない。
 *
 * ★代わりの歯止めが filled（補ったところの申告）。本文はきれいなまま書き切り、
 *   自分で決めた箇所だけを別に並べて、投稿前に見せる。
 *   文中に〔推測〕を挟むと汚くて読まれない。文とゲートを分ける。
 *
 * ★ただし filled は自己申告で、漏れる。これは確認を助ける道具であって、
 *   本文を読まなくてよくする免罪符ではない。画面の文言でもそう言う。
 *
 * ★書式は本番の社内投稿68件を数えて決めた（作り話をしない）。
 *   多いのは「①〜してください」を見出しにして、その下に全角スペースで字下げした短い段落。
 *   番号 27件 / 太字 26件 / 見出し 7件 に対し、「・」の箇条書きは7件、リストタグは1件。
 *   挨拶も名乗りも結びも無い。
 */

/** 下書きの1ブロック。見出しか段落かだけを持つ（装飾はブラウザ側で付ける） */
export interface ComposeBlock {
  /** true=見出し（①〜のやること）。false=その下の説明 */
  heading: boolean;
  text: string;
}

/** 補ったものの種類。★AIに自由に名付けさせない（画面の並びが毎回変わる） */
export const FILLED_KINDS = ['期限', '対象', '数量', '場所', '段取り'] as const;
export type FilledKind = (typeof FILLED_KINDS)[number];

/**
 * 指示に無かったのにAIが決めたこと。
 * ★言い回しを整えただけのものは入れない。中身を足したものだけ。
 */
export interface FilledNote {
  /** 書いた内容（本文から抜き出した短い断片） */
  what: string;
  kind: FilledKind;
}

export interface ComposeResult {
  blocks: ComposeBlock[];
  filled: FilledNote[];
}

/** 作れるブロック数の上限。本番の最長投稿は821字・29段落 */
export const MAX_BLOCKS = 40;
/** 1ブロックの上限 */
export const MAX_BLOCK_LENGTH = 400;
/** 申告の上限。これを超えるほど補うなら、そもそも指示が短すぎる */
export const MAX_FILLED = 12;
/** 申告1件の長さ。本文の断片なので短い */
export const MAX_FILLED_LENGTH = 60;

/**
 * 空欄の印。★丸括弧や全角括弧にしない（本文に出てくる）。
 *
 * 空欄はもう作らせないが、言うことを聞かずに [ ] を出してくることがある。
 * そのまま投稿すると講師が読むので、見つけたら画面で知らせるための保険として残す。
 */
export const BLANK_RE = /\[[^\]\n]{0,24}\]/g;

export function countBlanks(text: string): number {
  return (text.match(BLANK_RE) ?? []).length;
}

export function composeSystemPrompt(): string {
  return [
    'あなたは学習塾の教室長です。教室の講師に向けた連絡を、最後まで書き切ります。',
    '',
    '■ いちばん大事なこと',
    '- 渡される指示は一言だけのことが多い（「PCS配布」など）。それを、そのまま投稿できる連絡文にする。',
    '- ★空欄を作らない。角括弧・「未定」・「〜については追って」で逃げない。',
    '  塾の連絡としてふつうに入る内容は、自分で決めて書き切る。',
    '- 決めた内容は、投稿する前に教室長が直す。書かないより、書いて直させるほうがよい。',
    '',
    '■ 書き方（この教室の実際の書式）',
    '- やることが2件以上なら、1件ずつ「①〜してください」の形の見出しにする。',
    '  ★見出しそのものを、何をするかの一文にする。「①について」のような題名にしない。',
    '- 見出しの下に、補足を1〜3行。各行の先頭に全角スペースを1つ入れる。',
    '- やることが1件だけなら、見出しを付けず本文だけを書く。1〜2行で終わらせてよい。',
    '- 語尾は「〜してください」「〜すること」。ですます調。',
    '',
    '■ 書かないもの',
    '- ★挨拶・名乗り・結び。「お疲れさまです」「〜の高橋です」「よろしくお願いします」は書かない。',
    '- ★前置き。「お忙しいところ恐れ入りますが」のような言い回しを足さない。',
    '- ★その教室の中でしか通じない固有の情報。教材の棚番号・内線番号・人名・金額・特定のファイル名。',
    '  これは推測しようがなく、外すと講師が探して見つからない。触れずに書く（空欄にもしない）。',
    '',
    '■ 補ったものを申告する',
    '- 指示に書かれていないのに自分で決めたことを filled に並べる。',
    '  what=本文に書いた内容の短い抜き出し / kind=次のどれか: 期限・対象・数量・場所・段取り',
    '- ★言い回しを整えただけのものは入れない。中身を足したものだけを入れる。',
    '- 指示にそのまま書かれていたことは入れない。',
    '',
    '■ 直しの指示が来たとき',
    '- いまの本文が一緒に渡される。指示された箇所だけを変え、ほかはそのまま残す。',
    '- 「もっと短く」なら、事実を削らずに言い回しだけ短くする。',
    '- このときの filled は、その直しで新しく決めたぶんだけにする。',
    '',
    '出力はJSONだけ。前置きは書かない:',
    '{"blocks":[{"heading":true,"text":"①PCSを配布してください"},' +
      '{"heading":false,"text":"　小学生は国語・算数、中学生は英語・数学に出してください。"}],' +
      '"filled":[{"what":"小学生は国語・算数、中学生は英語・数学","kind":"対象"}]}',
  ].join('\n');
}

export function composeUserText(params: {
  instruction: string;
  /** 作り直しのときだけ。いまの本文 */
  currentLines?: readonly string[];
}): string {
  const parts = [`【指示】\n${params.instruction}`];
  if (params.currentLines && params.currentLines.length > 0) {
    parts.push(`【いまの本文】\n${params.currentLines.join('\n')}`);
    parts.push('※ 指示された箇所だけを直し、ほかはそのまま残してください。');
  }
  return parts.join('\n\n');
}

/** 種類が決めた5つのどれか。外れたものは捨てる（画面の並びを崩さない） */
function toFilledKind(raw: unknown): FilledKind | null {
  if (typeof raw !== 'string') return null;
  return (FILLED_KINDS as readonly string[]).includes(raw) ? (raw as FilledKind) : null;
}

/**
 * AIの生の出力を、使ってよい形にする。
 * ★読めない行は捨てる。1つも残らなければ空を返し、呼び出し側が本文を触らない。
 */
export function parseComposeResult(raw: unknown): ComposeResult {
  const obj = raw && typeof raw === 'object' ? (raw as { blocks?: unknown; filled?: unknown }) : {};
  const rows = Array.isArray(obj.blocks) ? (obj.blocks as unknown[]) : [];

  const blocks: ComposeBlock[] = [];
  for (const row of rows) {
    if (blocks.length >= MAX_BLOCKS) break;
    if (!row || typeof row !== 'object') continue;
    const r = row as { heading?: unknown; text?: unknown };
    if (typeof r.text !== 'string') continue;

    const text = r.text.replace(/\s+$/, '');
    if (!text.trim()) continue;
    if (text.length > MAX_BLOCK_LENGTH) continue;

    blocks.push({ heading: r.heading === true, text });
  }

  // ★申告は本文があるときだけ意味を持つ。本文を捨てたなら申告も捨てる
  const filled: FilledNote[] = [];
  const seen = new Set<string>();
  const notes = Array.isArray(obj.filled) ? (obj.filled as unknown[]) : [];
  if (blocks.length > 0) {
    for (const note of notes) {
      if (filled.length >= MAX_FILLED) break;
      if (!note || typeof note !== 'object') continue;
      const n = note as { what?: unknown; kind?: unknown };
      const kind = toFilledKind(n.kind);
      if (!kind) continue;
      if (typeof n.what !== 'string') continue;

      const what = n.what.trim();
      if (!what || what.length > MAX_FILLED_LENGTH) continue;
      // 同じことを2回申告してくることがある
      const key = `${kind} ${what}`;
      if (seen.has(key)) continue;
      seen.add(key);

      filled.push({ what, kind });
    }
  }

  return { blocks, filled };
}
