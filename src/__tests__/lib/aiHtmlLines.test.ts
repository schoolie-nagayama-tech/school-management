/**
 * 本文（リッチテキスト）と「行」の相互変換のテスト。
 *
 * ★守りたいのは1点: 整えても書式が壊れないこと。
 *   入れ物（h3 / p / strong）は触らず、中の文字だけ差し替える。
 *   タグごと作り直すと、太字や見出しが勝手に変わる。
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { applyLinesToHtml, blocksToHtml, countBlanksInHtml, htmlToLines } from '@/lib/ai/htmlLines';
import { BLANK_RE } from '@/lib/ai/compose';

/** 本番の社内投稿と同じ形（h3+strong の見出し＋全角字下げの段落） */
const REAL = '<h3><strong>①PCSを配布してください</strong></h3><p>　小学生に出してください。</p>';

describe('htmlToLines', () => {
  it('見出しと段落を行に割り、見出しかどうかを持つ', () => {
    const got = htmlToLines(REAL);
    expect(got).toEqual([
      { index: 0, text: '①PCSを配布してください', heading: true },
      { index: 1, text: '　小学生に出してください。', heading: false },
    ]);
  });

  it('空のブロックは飛ばすが、あとの行の位置はずれない', () => {
    const got = htmlToLines('<p>あ</p><p></p><p>い</p>');
    expect(got.map((l) => l.index)).toEqual([0, 2]);
  });
});

describe('applyLinesToHtml', () => {
  it('★見出しの太字を壊さずに文字だけ入れ替える', () => {
    const got = applyLinesToHtml(REAL, [{ index: 0, text: '①PCSを配ってください' }]);
    expect(got).toContain('<h3><strong>①PCSを配ってください</strong></h3>');
    expect(got).toContain('<p>　小学生に出してください。</p>');
  });

  it('渡さなかった行はそのまま残す', () => {
    const got = applyLinesToHtml(REAL, []);
    expect(htmlToLines(got)).toEqual(htmlToLines(REAL));
  });

  it('知らない番号は無視する（行が増えない）', () => {
    const got = applyLinesToHtml(REAL, [{ index: 99, text: '勝手な行' }]);
    expect(got).not.toContain('勝手な行');
    expect(htmlToLines(got)).toHaveLength(2);
  });
});

describe('blocksToHtml', () => {
  it('見出しは h3+strong、段落は p にする（実物と同じ書式）', () => {
    const got = blocksToHtml([
      { heading: true, text: '①あ' },
      { heading: false, text: '　い' },
    ]);
    expect(got).toBe('<h3><strong>①あ</strong></h3><p>　い</p>');
  });

  it('本文の記号をそのまま埋め込まない（タグとして解釈させない）', () => {
    const got = blocksToHtml([{ heading: false, text: '<script>だめ</script>' }]);
    expect(got).not.toContain('<script>');
    expect(got).toContain('&lt;script&gt;');
  });
});

describe('countBlanksInHtml', () => {
  it('本文の中の空欄を数える', () => {
    expect(countBlanksInHtml('<p>[いつまで]に[どこへ]</p>', BLANK_RE)).toBe(2);
    expect(countBlanksInHtml(REAL, BLANK_RE)).toBe(0);
  });

  it('★何度呼んでも同じ数になる（正規表現の状態を持ち回らない）', () => {
    const html = '<p>[あ][い]</p>';
    expect(countBlanksInHtml(html, BLANK_RE)).toBe(2);
    expect(countBlanksInHtml(html, BLANK_RE)).toBe(2);
  });
});
