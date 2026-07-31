/**
 * テキスト（教材）の属性表示のテスト。
 *
 * ★ 本番に学年・学校種別が未設定のテキストが実在する（648件中1件）ため、
 *   欠損時に中黒だけが残らないことを固定する。
 */
import { describe, it, expect } from 'vitest';
import { formatTextbookGrade, formatTextbookMeta } from '@/lib/utils/textbookLabel';

describe('formatTextbookGrade', () => {
  it('学校種別と学年を連結する', () => {
    expect(formatTextbookGrade('小学', '5年')).toBe('小学5年');
    expect(formatTextbookGrade('高校', '共通')).toBe('高校共通');
  });

  it('片方だけならその値、どちらも無ければ空文字', () => {
    expect(formatTextbookGrade('小学', null)).toBe('小学');
    expect(formatTextbookGrade(null, '5年')).toBe('5年');
    expect(formatTextbookGrade(null, null)).toBe('');
    expect(formatTextbookGrade(undefined, undefined)).toBe('');
  });
});

describe('formatTextbookMeta', () => {
  it('学年・科目を中黒でつなぐ', () => {
    expect(formatTextbookMeta('小学', '6年', '算数')).toBe('小学6年・算数');
  });

  it('学年が無いときは中黒を残さない', () => {
    expect(formatTextbookMeta(null, null, '算数')).toBe('算数');
  });

  it('科目が無いときは中黒を残さない', () => {
    expect(formatTextbookMeta('小学', '6年', null)).toBe('小学6年');
  });

  it('すべて未設定なら空文字（呼び出し側で非表示にする）', () => {
    expect(formatTextbookMeta(null, null, null)).toBe('');
  });
});
