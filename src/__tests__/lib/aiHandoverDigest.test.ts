/**
 * 「これまでの引継ぎをまとめる」のテスト。
 *
 * ★守りたいのは2点:
 *  - 時系列が壊れないこと（順番が入れ替わる・渡していない日付が生えると、
 *    「いつからそうなったか」が読めなくなり、この機能の値打ちが無くなる）
 *  - 読めない出力で画面が壊れないこと（空を返して呼び出し側が「作れなかった」に倒せる）
 */
import { describe, expect, it } from 'vitest';
import {
  digestSystemPrompt,
  digestUserText,
  parseDigestResult,
  MAX_LINE_LENGTH,
  MAX_POINTS,
  type HandoverEntry,
} from '@/lib/ai/handoverDigest';

const entry = (over: Partial<HandoverEntry> = {}): HandoverEntry => ({
  date: '2026-09-01',
  teacher: '山田 太郎',
  text: '方程式の計算ミスが多いです',
  homeworkNotDone: false,
  tardy: false,
  ...over,
});

/** 41字（上限ちょうど超え）の行 */
const tooLong = 'あ'.repeat(MAX_LINE_LENGTH + 1);

describe('digestSystemPrompt', () => {
  it('★時系列のまま畳ませる（1つの文にまとめさせない）', () => {
    const p = digestSystemPrompt();
    expect(p).toContain('時系列のまま畳む');
    expect(p).toContain('まとめて1つの文にしない');
  });

  it('★書かれていないことを足させない', () => {
    expect(digestSystemPrompt()).toContain('書かれていないことを足さない');
  });

  it('渡していない日付を作らせない・順番も変えさせない', () => {
    const p = digestSystemPrompt();
    expect(p).toContain('渡していない日付を作らない');
    expect(p).toContain('順番も変えない');
  });

  it('1行の字数と件数の上限を伝える', () => {
    const p = digestSystemPrompt();
    expect(p).toContain(`${MAX_LINE_LENGTH}字`);
    expect(p).toContain(`${MAX_POINTS}つまで`);
  });
});

describe('digestUserText', () => {
  it('古い順のまま並べる（並べ替えない）', () => {
    const t = digestUserText([
      entry({ date: '2026-08-01', text: '古いほう' }),
      entry({ date: '2026-09-01', text: '新しいほう' }),
    ]);
    expect(t.indexOf('古いほう')).toBeLessThan(t.indexOf('新しいほう'));
    expect(t).toContain('古い順・2回');
  });

  it('「日付 講師: 本文」の形で渡す', () => {
    expect(digestUserText([entry()])).toContain('2026/09/01 山田 太郎: 方程式の計算ミスが多いです');
  });

  it('★宿題未提出・遅刻は末尾に印を付ける', () => {
    const t = digestUserText([entry({ homeworkNotDone: true, tardy: true })]);
    expect(t).toContain('（宿題未提出）（遅刻）');
  });

  it('印が要らない回には付けない', () => {
    const t = digestUserText([entry()]);
    expect(t).not.toContain('（宿題未提出）');
    expect(t).not.toContain('（遅刻）');
  });

  it('本文の改行は潰して1件1行にする（行が崩れると日付とずれる）', () => {
    const t = digestUserText([entry({ text: '前半\n後半' })]);
    expect(t).toContain('前半 後半');
    expect(t.split('\n')).toHaveLength(2); // 見出し + 1件
  });
});

describe('parseDigestResult', () => {
  const sent = ['2026-08-01', '2026-09-01'];

  it('渡した日付の行だけを採る', () => {
    const got = parseDigestResult(
      {
        timeline: [
          { date: '2026-08-01', line: 'あ' },
          { date: '2026-09-01', line: 'い' },
        ],
      },
      sent
    );
    expect(got.timeline).toEqual([
      { date: '2026-08-01', line: 'あ' },
      { date: '2026-09-01', line: 'い' },
    ]);
  });

  it('★渡していない日付は捨てる', () => {
    const got = parseDigestResult(
      {
        timeline: [
          { date: '2026-08-01', line: 'あ' },
          { date: '2026-07-01', line: '作り話' },
        ],
      },
      sent
    );
    expect(got.timeline).toEqual([{ date: '2026-08-01', line: 'あ' }]);
  });

  it('★渡した順に並べ直す', () => {
    const got = parseDigestResult(
      {
        timeline: [
          { date: '2026-09-01', line: 'い' },
          { date: '2026-08-01', line: 'あ' },
        ],
      },
      sent
    );
    expect(got.timeline.map((t) => t.date)).toEqual(['2026-08-01', '2026-09-01']);
  });

  it('同じ日付を渡した回数より多くは採らない（同じ日に2コマあることがある）', () => {
    const got = parseDigestResult(
      {
        timeline: [
          { date: '2026-08-01', line: '1コマ目' },
          { date: '2026-08-01', line: '2コマ目' },
          { date: '2026-08-01', line: 'よけいな行' },
        ],
      },
      ['2026-08-01', '2026-08-01']
    );
    expect(got.timeline.map((t) => t.line)).toEqual(['1コマ目', '2コマ目']);
  });

  it('★40字を超える行は捨てる（切り詰めない）', () => {
    const got = parseDigestResult(
      {
        timeline: [
          { date: '2026-08-01', line: tooLong },
          { date: '2026-09-01', line: 'い' },
        ],
      },
      sent
    );
    expect(got.timeline).toEqual([{ date: '2026-09-01', line: 'い' }]);
  });

  it('40字ちょうどは残す', () => {
    const just = 'あ'.repeat(MAX_LINE_LENGTH);
    const got = parseDigestResult({ timeline: [{ date: '2026-08-01', line: just }] }, sent);
    expect(got.timeline).toHaveLength(1);
  });

  it('★ずっとある課題・次に気をつけることは上限で切る', () => {
    const got = parseDigestResult(
      {
        timeline: [{ date: '2026-08-01', line: 'あ' }],
        ongoing: ['1', '2', '3', '4', '5'],
        nextCare: ['a', 'b', 'c', 'd'],
      },
      sent
    );
    expect(got.ongoing).toHaveLength(MAX_POINTS);
    expect(got.nextCare).toHaveLength(MAX_POINTS);
  });

  it('課題・気をつけることも40字超は捨て、重複はまとめる', () => {
    const got = parseDigestResult(
      {
        timeline: [{ date: '2026-08-01', line: 'あ' }],
        ongoing: [tooLong, '分数', '分数', '  '],
      },
      sent
    );
    expect(got.ongoing).toEqual(['分数']);
  });

  it('★読めない出力なら空（呼び出し側が「作れなかった」に倒せる）', () => {
    for (const raw of [null, undefined, 'これはJSONではありません', {}, { timeline: 'ちがう' }]) {
      const got = parseDigestResult(raw, sent);
      expect(got).toEqual({ timeline: [], ongoing: [], nextCare: [] });
    }
  });

  it('★経緯が1行も残らなければ、課題も気をつけることも出さない', () => {
    const got = parseDigestResult(
      {
        timeline: [{ date: '2026-01-01', line: '渡していない日付' }],
        ongoing: ['分数'],
        nextCare: ['宿題'],
      },
      sent
    );
    expect(got).toEqual({ timeline: [], ongoing: [], nextCare: [] });
  });

  it('形が違う行は飛ばす（数値・null・欠けた項目）', () => {
    const got = parseDigestResult(
      {
        timeline: [
          null,
          42,
          { date: '2026-08-01' },
          { line: 'あ' },
          { date: '2026-09-01', line: '  ' },
          { date: '2026-09-01', line: 'い' },
        ],
      },
      sent
    );
    expect(got.timeline).toEqual([{ date: '2026-09-01', line: 'い' }]);
  });

  it('パーサは講師名を埋めない（名前はサーバー側で付け直す）', () => {
    const got = parseDigestResult(
      { timeline: [{ date: '2026-08-01', line: 'あ', teacher: '偽名' }] },
      sent
    );
    expect(got.timeline[0].teacher).toBeUndefined();
  });
});
