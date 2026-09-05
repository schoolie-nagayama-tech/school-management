/**
 * 下書きを作る側のテスト。
 *
 * ★守りたいのは2点:
 *  - 読めない出力で本文を書き換えないこと（空を返し、呼び出し側が触らない）
 *  - 「知らないことは空欄で残す」という約束が、プロンプトから消えないこと
 */
import { describe, expect, it } from 'vitest';
import {
  composeSystemPrompt,
  composeUserText,
  countBlanks,
  MAX_BLOCKS,
  parseComposeResult,
} from '@/lib/ai/compose';

describe('parseComposeResult', () => {
  it('見出しと段落を読み取り、空欄の数を数える', () => {
    const got = parseComposeResult({
      blocks: [
        { heading: true, text: '①PCSを配布してください' },
        { heading: false, text: '　[どこに置いてある]から持っていってください。' },
      ],
    });
    expect(got.blocks).toHaveLength(2);
    expect(got.blocks[0].heading).toBe(true);
    expect(got.blocks[1].heading).toBe(false);
    expect(got.blankCount).toBe(1);
  });

  it('★読めない出力は空を返す（本文を書き換えさせない）', () => {
    for (const raw of [null, 'こんにちは', {}, { blocks: 'だめ' }, { blocks: [1, 2] }]) {
      expect(parseComposeResult(raw).blocks).toEqual([]);
    }
  });

  it('空文字のブロックは捨てる', () => {
    const got = parseComposeResult({ blocks: [{ text: '  ' }, { text: 'あり' }] });
    expect(got.blocks).toHaveLength(1);
  });

  it('長すぎるブロックは採らない', () => {
    const got = parseComposeResult({ blocks: [{ text: 'あ'.repeat(500) }] });
    expect(got.blocks).toEqual([]);
  });

  it('ブロック数に上限がある', () => {
    const many = Array.from({ length: MAX_BLOCKS + 10 }, (_, i) => ({ text: `行${i}` }));
    expect(parseComposeResult({ blocks: many }).blocks).toHaveLength(MAX_BLOCKS);
  });

  it('heading は true のときだけ見出しにする（曖昧な値を見出しにしない）', () => {
    const got = parseComposeResult({
      blocks: [
        { heading: 'yes', text: 'あ' },
        { heading: 1, text: 'い' },
      ],
    });
    expect(got.blocks.every((b) => b.heading === false)).toBe(true);
  });
});

describe('countBlanks', () => {
  it('角括弧の空欄を数える', () => {
    expect(countBlanks('［なし］')).toBe(0); // 全角は数えない
    expect(countBlanks('[いつまで]までに[どこに]')).toBe(2);
    expect(countBlanks('空欄なし')).toBe(0);
  });

  it('改行をまたぐものは空欄とみなさない', () => {
    expect(countBlanks('[あ\nい]')).toBe(0);
  });
});

describe('composeSystemPrompt', () => {
  it('★推測して埋めないという約束を含む', () => {
    const p = composeSystemPrompt();
    expect(p).toContain('推測して埋めない');
    expect(p).toContain('自分で作らない');
  });

  it('★挨拶・名乗り・結びを書かないという約束を含む', () => {
    const p = composeSystemPrompt();
    expect(p).toContain('挨拶');
    expect(p).toContain('名乗り');
    expect(p).toContain('結び');
  });
});

describe('composeUserText', () => {
  it('本文が無ければ指示だけを渡す', () => {
    const t = composeUserText({ instruction: '・PCS配布' });
    expect(t).toContain('・PCS配布');
    expect(t).not.toContain('いまの本文');
  });

  it('本文があれば「指示された箇所だけ直す」と伝える', () => {
    const t = composeUserText({ instruction: '短く', currentLines: ['①あ', '　い'] });
    expect(t).toContain('いまの本文');
    expect(t).toContain('指示された箇所だけ');
  });
});
