/**
 * 指示から本文の下書きを作る。
 *
 * 正典: docs/ai-features-integration-plan.md
 *
 * ★書式は本番の社内投稿68件を数えて決めた（作り話をしない）。
 *   実際に多いのは「①〜してください」を太字の見出しにして、その下に
 *   全角スペースで字下げした短い段落を並べる形。
 *   番号 27件 / 太字 26件 / 見出し 7件 に対し、「・」の箇条書きは7件、リストタグは1件だけ。
 *   挨拶も名乗りも結びも無い。
 *
 * ★知らないことは書かない。「12番に置いてあります」のような具体は教室長しか知らず、
 *   AIが埋めると読んだ講師がそのまま信じる。値が要るのに指示に無ければ空欄で残す。
 *
 * ★空欄の印は [ ] にする。本番の社内投稿68件に「[」は1件も出てこないので、
 *   もともとの本文と衝突しない。
 */

/** 下書きの1ブロック。見出しか段落かだけを持つ（装飾はブラウザ側で付ける） */
export interface ComposeBlock {
  /** true=見出し（①〜のやること）。false=その下の説明 */
  heading: boolean;
  text: string;
}

export interface ComposeResult {
  blocks: ComposeBlock[];
  /** 埋まっていない空欄の数。画面は投稿前に確認を出す */
  blankCount: number;
}

/** 作れるブロック数の上限。本番の最長投稿は821字・29段落 */
export const MAX_BLOCKS = 40;
/** 1ブロックの上限 */
export const MAX_BLOCK_LENGTH = 400;

/** 空欄の印。★丸括弧や全角括弧にしない（本文に出てくる） */
export const BLANK_RE = /\[[^\]\n]{0,24}\]/g;

export function countBlanks(text: string): number {
  return (text.match(BLANK_RE) ?? []).length;
}

export function composeSystemPrompt(): string {
  return [
    'あなたは学習塾の教室長です。教室の講師に向けた連絡を、指示どおりに書きます。',
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
    '- ★指示に無い事実。日付・時刻・金額・数量・場所・教材名・人名を自分で作らない。',
    '',
    '■ 分からないところ',
    '- 文として値が要るのに指示に書かれていないときは、[いつまで] [どこに置いてある] のように、',
    '  角括弧で「何が要るか」を書いて空けておく。★推測して埋めない。',
    '- 指示に書かれていることは、言い換えずにそのまま使う。',
    '',
    '■ 直しの指示が来たとき',
    '- いまの本文が一緒に渡される。指示された箇所だけを変え、ほかはそのまま残す。',
    '- 「もっと短く」なら、事実を削らずに言い回しだけ短くする。',
    '',
    '出力はJSONだけ。前置きは書かない:',
    '{"blocks":[{"heading":true,"text":"①PCSを配布してください"},{"heading":false,"text":"　小学生は国語算数、中学生は英数を出してください。"}]}',
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

/**
 * AIの生の出力を、使ってよい形にする。
 * ★読めない行は捨てる。1つも残らなければ空を返し、呼び出し側が本文を触らない。
 */
export function parseComposeResult(raw: unknown): ComposeResult {
  const rows =
    raw && typeof raw === 'object' && Array.isArray((raw as { blocks?: unknown }).blocks)
      ? ((raw as { blocks: unknown[] }).blocks as unknown[])
      : [];

  const blocks: ComposeBlock[] = [];
  let blankCount = 0;

  for (const row of rows) {
    if (blocks.length >= MAX_BLOCKS) break;
    if (!row || typeof row !== 'object') continue;
    const r = row as { heading?: unknown; text?: unknown };
    if (typeof r.text !== 'string') continue;

    const text = r.text.replace(/\s+$/, '');
    if (!text.trim()) continue;
    if (text.length > MAX_BLOCK_LENGTH) continue;

    blocks.push({ heading: r.heading === true, text });
    blankCount += countBlanks(text);
  }

  return { blocks, blankCount };
}
