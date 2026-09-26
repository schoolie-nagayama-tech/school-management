/**
 * 成績セルの入力の読み方（「テストなし」を含む）のテスト。
 *
 * 3つの入力画面（生徒の成績ページ・生徒詳細の成績・成績一覧）が同じ関数を使うので、
 * ここで入力の決まりを固定する。
 *  - × / x / - などはテストなし（日本語入力のまま打った全角も受ける）
 *  - 空は未入力（テストなしも外す）
 *  - 数値は値（全角数字も受ける）
 *  - それ以外は保存しない
 */
import { describe, expect, it } from 'vitest';
import {
  NO_TEST_MARK,
  parseScoreInput,
  parsedToScoreState,
  scoreEditText,
} from '@/lib/scores/scoreInput';

describe('parseScoreInput', () => {
  it.each(['×', 'x', 'X', '-', '－', 'ー', 'ｘ', 'Ｘ', ' x ', '✕'])('%s はテストなし', (text) => {
    expect(parseScoreInput(text)).toEqual({ kind: 'noTest' });
  });

  it('空・空白だけは未入力', () => {
    expect(parseScoreInput('')).toEqual({ kind: 'empty' });
    expect(parseScoreInput('   ')).toEqual({ kind: 'empty' });
    expect(parseScoreInput('　')).toEqual({ kind: 'empty' });
  });

  it('数値は値（0 や小数、全角数字も）', () => {
    expect(parseScoreInput('80')).toEqual({ kind: 'value', value: 80 });
    expect(parseScoreInput('0')).toEqual({ kind: 'value', value: 0 });
    expect(parseScoreInput('52.5')).toEqual({ kind: 'value', value: 52.5 });
    expect(parseScoreInput('８５')).toEqual({ kind: 'value', value: 85 });
  });

  it('数値でも × でもないものは不正', () => {
    expect(parseScoreInput('abc')).toEqual({ kind: 'invalid' });
    expect(parseScoreInput('80点')).toEqual({ kind: 'invalid' });
    expect(parseScoreInput('--')).toEqual({ kind: 'invalid' });
  });
});

describe('parsedToScoreState', () => {
  it('テストなしは値を空にして印を立てる（DB の check に合わせる）', () => {
    expect(parsedToScoreState({ kind: 'noTest' })).toEqual({ value: null, no_test: true });
  });

  it('値・空はどちらも印を外す', () => {
    expect(parsedToScoreState({ kind: 'value', value: 70 })).toEqual({ value: 70, no_test: false });
    expect(parsedToScoreState({ kind: 'empty' })).toEqual({ value: null, no_test: false });
  });

  it('不正は保存しない', () => {
    expect(parsedToScoreState({ kind: 'invalid' })).toBeNull();
  });
});

describe('scoreEditText', () => {
  it('テストなしのセルは × で開く', () => {
    expect(scoreEditText({ value: null, no_test: true })).toBe(NO_TEST_MARK);
  });

  it('値はそのまま、未入力は空で開く', () => {
    expect(scoreEditText({ value: 0 })).toBe('0');
    expect(scoreEditText({ value: null, no_test: false })).toBe('');
    expect(scoreEditText(null)).toBe('');
  });
});
