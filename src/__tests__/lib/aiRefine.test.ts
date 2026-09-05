/**
 * 「整える」の土台のテスト。
 *
 * ★守りたいのは1点に尽きる: AIの申告を信じないこと。
 *   行を増やす・減らす・順番を変える・空にする、をプロンプトで頼むのではなく、
 *   パーサ側で機械的に弾けているかを見る。
 */
import { describe, expect, it } from 'vitest';
import {
  parseRefineResult,
  refineSystemPrompt,
  toRefineLines,
  type RefineLine,
} from '@/lib/ai/refine';

const sent: RefineLine[] = [
  { index: 0, text: '通知表を集めてください' },
  { index: 2, text: '期限は7月末です' },
];

describe('toRefineLines', () => {
  it('空行は送らないが、元の位置（index）は保つ', () => {
    const got = toRefineLines(['あ', '', '  ', 'い']);
    expect(got).toEqual([
      { index: 0, text: 'あ' },
      { index: 3, text: 'い' },
    ]);
  });

  it('長すぎる行は送らない（そこだけ整えないほうが安全）', () => {
    const got = toRefineLines(['短い', 'あ'.repeat(1000)]);
    expect(got).toHaveLength(1);
    expect(got[0].index).toBe(0);
  });
});

describe('parseRefineResult', () => {
  it('整えた行を反映し、変わった行だけを changes に出す', () => {
    const got = parseRefineResult({ lines: [{ index: 0, text: '通知表をお集めください' }] }, sent);
    expect(got.lines).toEqual([
      { index: 0, text: '通知表をお集めください' },
      { index: 2, text: '期限は7月末です' },
    ]);
    expect(got.changes).toEqual([
      { index: 0, before: '通知表を集めてください', after: '通知表をお集めください' },
    ]);
  });

  it('★渡していない番号は捨てる（行を増やされない）', () => {
    const got = parseRefineResult({ lines: [{ index: 99, text: '勝手に足した行' }] }, sent);
    expect(got.lines).toHaveLength(2);
    expect(got.lines.map((l) => l.text)).not.toContain('勝手に足した行');
    expect(got.changes).toEqual([]);
  });

  it('★返ってこなかった行は元のまま残す（消させない）', () => {
    const got = parseRefineResult({ lines: [{ index: 0, text: 'なおした' }] }, sent);
    expect(got.lines[1]).toEqual({ index: 2, text: '期限は7月末です' });
  });

  it('★空文字にされたら元のまま（消させない）', () => {
    const got = parseRefineResult({ lines: [{ index: 0, text: '   ' }] }, sent);
    expect(got.lines[0].text).toBe('通知表を集めてください');
    expect(got.changes).toEqual([]);
  });

  it('★順番を入れ替えて返されても、渡した順のまま返す', () => {
    const got = parseRefineResult(
      {
        lines: [
          { index: 2, text: '期限は7月末まで' },
          { index: 0, text: '通知表をお集めください' },
        ],
      },
      sent
    );
    expect(got.lines.map((l) => l.index)).toEqual([0, 2]);
  });

  it('読めない出力なら、全部そのまま返して変更なしにする', () => {
    for (const raw of [null, 'こんにちは', {}, { lines: 'だめ' }, { lines: [1, 2] }]) {
      const got = parseRefineResult(raw, sent);
      expect(got.lines).toEqual(sent);
      expect(got.changes).toEqual([]);
    }
  });

  it('長すぎる行を返されたら採らない', () => {
    const got = parseRefineResult({ lines: [{ index: 0, text: 'あ'.repeat(1000) }] }, sent);
    expect(got.lines[0].text).toBe('通知表を集めてください');
  });
});

describe('refineSystemPrompt', () => {
  it('事実を足さない・削らないを必ず含む（ここが緩むと日付や金額が作られる）', () => {
    const p = refineSystemPrompt('bulletin');
    expect(p).toContain('足さない');
    expect(p).toContain('削らない');
    expect(p).toContain('要約しない');
  });
});
