/**
 * おまかせ下書きの「使われ方」の判定のテスト。
 *
 * ★ここで守りたいのは「ボタンを押させずに取れる数が、意味のある数であること」。
 *   空白の違いで 'edited' に倒れると 'used_as_is' がほぼ0件になり、
 *   いちばん知りたい「そのまま出せた率」が取れなくなる。
 */
import { describe, expect, it } from 'vitest';
import { judgeComposeUsage } from '@/lib/ai/composeUsage';

describe('judgeComposeUsage', () => {
  it('行がそのまま同じなら used_as_is', () => {
    const lines = ['PCSを配布します', '7月31日までに提出してください'];
    const r = judgeComposeUsage(lines, lines);
    expect(r.verdict).toBe('used_as_is');
    expect(r.kept).toBe(2);
  });

  it('1行でも違えば edited', () => {
    const ai = ['PCSを配布します', '7月31日までに提出してください'];
    const final = ['PCSを配布します', '7月25日までに提出してください'];
    const r = judgeComposeUsage(ai, final);
    expect(r.verdict).toBe('edited');
    expect(r.kept).toBe(1);
  });

  it('行を足しただけでも edited（残っている行は数える）', () => {
    const ai = ['PCSを配布します'];
    const final = ['PCSを配布します', '置き場所は事務室です'];
    const r = judgeComposeUsage(ai, final);
    expect(r.verdict).toBe('edited');
    expect(r.kept).toBe(1);
  });

  it('AIの行が1行も残っていなければ discarded', () => {
    const r = judgeComposeUsage(['PCSを配布します'], ['明日は休講です']);
    expect(r.verdict).toBe('discarded');
    expect(r.kept).toBe(0);
  });

  it('最終の本文が空なら discarded', () => {
    expect(judgeComposeUsage(['PCSを配布します'], []).verdict).toBe('discarded');
    expect(judgeComposeUsage(['PCSを配布します'], ['', '   ']).verdict).toBe('discarded');
  });

  /** ★エディタが空白を入れ替えるだけで「直した」と数えない */
  it('空白・全角空白の違いは無視する', () => {
    const ai = ['PCS を 配布します', '提出は7月31日'];
    const final = ['PCS　を　配布します', ' 提出は7月31日 '];
    const r = judgeComposeUsage(ai, final);
    expect(r.verdict).toBe('used_as_is');
    expect(r.kept).toBe(2);
  });

  it('空行は行として数えない', () => {
    const r = judgeComposeUsage(['本文です', ''], ['', '本文です']);
    expect(r.verdict).toBe('used_as_is');
    expect(r.kept).toBe(1);
  });

  /** AIが1行も出していなければ答え合わせにならない（呼ぶ側が防ぐが、ここでも捨てる） */
  it('AIの行が無ければ discarded', () => {
    const r = judgeComposeUsage([], ['手で書いた本文']);
    expect(r.verdict).toBe('discarded');
    expect(r.kept).toBe(0);
  });
});
