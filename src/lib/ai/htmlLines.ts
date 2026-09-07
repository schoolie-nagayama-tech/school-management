/**
 * リッチテキストの本文と「行」の相互変換。
 *
 * ★HTMLをサーバーで解析しない。Vercelのランタイムでは jsdom が動かず、
 *   本番の全ページが500になった事故がある。ブラウザにはDOMがあるので、
 *   割るのも戻すのもこちら側でやり、AIには文字だけを送る。
 *   外に出る情報も減る（書式や属性は送らない）。
 *
 * ★整えるときは元のブロックの入れ物（h3 / p）をそのまま使い、中の文字だけ差し替える。
 *   タグごと作り直すと、太字や見出しが勝手に変わる。
 *
 * 正典: docs/ai-features-integration-plan.md
 */

import type { ComposeBlock } from './compose';

/** 本文の1ブロック */
export interface HtmlLine {
  index: number;
  /** ブロックの中の文字（タグを除いたもの） */
  text: string;
  /** 見出しかどうか。下書きを組み立て直すときに使う */
  heading: boolean;
}

/** 行として扱うブロック要素。Tiptap の StarterKit が作るもの */
const BLOCK_SELECTOR = 'h1, h2, h3, p, li, blockquote';

/**
 * 本文（HTML）を行に割る。
 * ★空のブロックは飛ばすが、index は元の並びのまま残す（差し戻せるように）。
 */
export function htmlToLines(html: string): HtmlLine[] {
  if (typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks = Array.from(doc.body.querySelectorAll(BLOCK_SELECTOR));

  const lines: HtmlLine[] = [];
  blocks.forEach((el, i) => {
    const text = (el.textContent ?? '').replace(/ /g, ' ').trimEnd();
    if (!text.trim()) return;
    lines.push({ index: i, text, heading: /^H[1-3]$/.test(el.tagName) });
  });
  return lines;
}

/**
 * 整えた行を、元の本文に差し戻す。
 * ★入れ物（タグ）は触らず、中の文字だけ入れ替える。
 */
export function applyLinesToHtml(
  html: string,
  lines: readonly { index: number; text: string }[]
): string {
  if (typeof DOMParser === 'undefined') return html;
  const byIndex = new Map(lines.map((l) => [l.index, l.text]));

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks = Array.from(doc.body.querySelectorAll(BLOCK_SELECTOR));

  blocks.forEach((el, i) => {
    const next = byIndex.get(i);
    if (next === undefined) return;
    if ((el.textContent ?? '').trimEnd() === next) return;

    // ★見出しの <strong> のような中の装飾は残したい。
    //   中身が1つのタグだけなら、その中の文字だけ差し替える。
    const only = el.children.length === 1 && el.textContent === el.children[0].textContent;
    if (only) el.children[0].textContent = next;
    else el.textContent = next;
  });

  return doc.body.innerHTML;
}

/** 本文を作り直すときの組み立て。見出しは実物と同じ h3 + strong にする */
export function blocksToHtml(blocks: readonly ComposeBlock[]): string {
  return blocks
    .map((b) => {
      const text = escapeHtml(b.text);
      return b.heading ? `<h3><strong>${text}</strong></h3>` : `<p>${text}</p>`;
    })
    .join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 本文（HTML）から、空欄の数を数える */
export function countBlanksInHtml(html: string, blankRe: RegExp): number {
  if (typeof DOMParser === 'undefined') return 0;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const text = doc.body.textContent ?? '';
  // ★グローバルな正規表現は lastIndex を持ち回るので、都度作り直す
  return (text.match(new RegExp(blankRe.source, 'g')) ?? []).length;
}
