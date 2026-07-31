/**
 * フリガナ正規化のテスト。
 *
 * 検索・並び替えが last_name_kana / first_name_kana 依存なので、
 * ひらがなが混ざるとカタカナ検索から漏れる（本番で 363 名中 7 名発生）。
 */
import { describe, it, expect } from 'vitest';
import { toKatakana } from '@/lib/utils/kana';

describe('toKatakana', () => {
  it('ひらがなをカタカナにする', () => {
    expect(toKatakana('しらはた')).toBe('シラハタ');
    expect(toKatakana('りお')).toBe('リオ');
  });

  it('カタカナはそのまま', () => {
    expect(toKatakana('シラハタ')).toBe('シラハタ');
  });

  it('ひらがなとカタカナが混ざっていても揃う', () => {
    expect(toKatakana('シラはた')).toBe('シラハタ');
  });

  it('濁点・半濁点・小書き文字も変換する', () => {
    expect(toKatakana('がっき')).toBe('ガッキ');
    expect(toKatakana('ぱぴぷ')).toBe('パピプ');
    expect(toKatakana('ぁぃぅぇぉ')).toBe('ァィゥェォ');
  });

  it('長音符・中黒・空白はそのまま残す', () => {
    expect(toKatakana('とうきょう ー・')).toBe('トウキョウ ー・');
  });

  it('漢字・英数字は変換しない', () => {
    expect(toKatakana('白旗 Rio 123')).toBe('白旗 Rio 123');
  });

  it('「ゟ」(U+309F) は変換範囲外なのでそのまま', () => {
    // ぁ〜ゖ の範囲外。壊れて別の文字にならないことを確認する
    expect(toKatakana('ゟ')).toBe('ゟ');
  });

  it('空文字は空文字', () => {
    expect(toKatakana('')).toBe('');
  });
});
