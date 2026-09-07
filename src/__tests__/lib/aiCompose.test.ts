/**
 * 「おまかせ下書き」の生成側のテスト。
 *
 * ★守りたいのは3点:
 *  - 読めない出力で本文を書き換えないこと（空を返し、呼び出し側が触らない）
 *  - 「空欄で逃げない」という約束が、プロンプトから消えないこと
 *  - 補ったところの申告（filled）が、決めた5種類から外れないこと
 */
import { describe, expect, it } from 'vitest';
import {
  composeSystemPrompt,
  composeUserText,
  countBlanks,
  FILLED_KINDS,
  MAX_BLOCKS,
  MAX_FILLED,
  parseComposeResult,
} from '@/lib/ai/compose';

describe('parseComposeResult', () => {
  it('見出しと段落を読み取り、補ったところを受け取る', () => {
    const got = parseComposeResult({
      blocks: [
        { heading: true, text: '①PCSを配布してください' },
        { heading: false, text: '　小学生は国語・算数に出してください。' },
      ],
      filled: [{ what: '小学生は国語・算数', kind: '対象' }],
    });
    expect(got.blocks).toHaveLength(2);
    expect(got.blocks[0].heading).toBe(true);
    expect(got.blocks[1].heading).toBe(false);
    expect(got.filled).toEqual([{ what: '小学生は国語・算数', kind: '対象' }]);
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

describe('filled（補ったところの申告）', () => {
  it('★決めた5種類から外れた kind は捨てる（画面の並びを崩さない）', () => {
    const got = parseComposeResult({
      blocks: [{ text: 'あ' }],
      filled: [
        { what: '9月10日まで', kind: '期限' },
        { what: 'なにか', kind: '雰囲気' },
        { what: 'これも', kind: 42 },
      ],
    });
    expect(got.filled).toEqual([{ what: '9月10日まで', kind: '期限' }]);
  });

  it('★本文を捨てたなら申告も捨てる（本文と合わない確認を出さない）', () => {
    const got = parseComposeResult({
      blocks: [{ text: 'あ'.repeat(500) }],
      filled: [{ what: '9月10日まで', kind: '期限' }],
    });
    expect(got.blocks).toEqual([]);
    expect(got.filled).toEqual([]);
  });

  it('同じ申告を2回返してきたら1つにする', () => {
    const got = parseComposeResult({
      blocks: [{ text: 'あ' }],
      filled: [
        { what: '今週中', kind: '期限' },
        { what: '今週中', kind: '期限' },
      ],
    });
    expect(got.filled).toHaveLength(1);
  });

  it('申告の数に上限がある', () => {
    const many = Array.from({ length: MAX_FILLED + 5 }, (_, i) => ({
      what: `補い${i}`,
      kind: '対象',
    }));
    expect(parseComposeResult({ blocks: [{ text: 'あ' }], filled: many }).filled).toHaveLength(
      MAX_FILLED
    );
  });

  it('長すぎる申告は捨てる', () => {
    const got = parseComposeResult({
      blocks: [{ text: 'あ' }],
      filled: [{ what: 'あ'.repeat(200), kind: '対象' }],
    });
    expect(got.filled).toEqual([]);
  });

  it('filled が無くても本文は返す（申告は付属品）', () => {
    const got = parseComposeResult({ blocks: [{ text: 'あ' }] });
    expect(got.blocks).toHaveLength(1);
    expect(got.filled).toEqual([]);
  });
});

describe('countBlanks', () => {
  it('角括弧の空欄を数える（言うことを聞かずに [ ] を出したときの保険）', () => {
    expect(countBlanks('［なし］')).toBe(0); // 全角は数えない
    expect(countBlanks('[いつまで]までに[どこに]')).toBe(2);
    expect(countBlanks('空欄なし')).toBe(0);
  });

  it('改行をまたぐものは空欄とみなさない', () => {
    expect(countBlanks('[あ\nい]')).toBe(0);
  });
});

describe('composeSystemPrompt', () => {
  it('★空欄で逃げないという約束を含む（骨組みだけ返す設計に戻さない）', () => {
    const p = composeSystemPrompt();
    expect(p).toContain('空欄を作らない');
    expect(p).toContain('書き切る');
  });

  it('★教室の中でしか通じない固有の情報は書かせない', () => {
    const p = composeSystemPrompt();
    expect(p).toContain('棚番号');
    expect(p).toContain('触れずに書く');
  });

  it('★補ったものを申告させる（本文だけ渡して終わりにしない）', () => {
    const p = composeSystemPrompt();
    expect(p).toContain('filled');
    for (const kind of FILLED_KINDS) expect(p).toContain(kind);
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
