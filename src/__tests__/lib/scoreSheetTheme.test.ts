import { describe, expect, it } from 'vitest';
import {
  MAX_THEME_LENGTH,
  MAX_THEME_UNITS,
  parseThemeResult,
  sanitizeThemeInputs,
  themeUserText,
  type ThemeInput,
} from '@/lib/ai/scoreSheetTheme';

const math: ThemeInput = {
  key: 'math',
  gradeLabel: '中2',
  subject: '数学',
  books: ['2年 数学 フォレスタステップ'],
  units: [
    { title: '比例の式', koma: 1, intent: '苦手克服', reason: 'PCS 比例の式 ×' },
    { title: '立体の体積', koma: 1, intent: '苦手克服', reason: 'PCS 立体の表面積と体積 ×' },
    { title: '1～6章のまとめ', koma: 1, intent: '定着', reason: '' },
  ],
};

describe('themeUserText', () => {
  it('教科ごとに key・合計コマ・単元・目的タグ・根拠を並べる', () => {
    const t = themeUserText([math]);
    expect(t).toContain('--- key: math');
    expect(t).toContain('単元（3件・計3コマ）');
    expect(t).toContain('- 比例の式 1コマ［苦手克服］　根拠: PCS 比例の式 ×');
    // 根拠の無い単元は「根拠:」を付けない
    expect(t.endsWith('- 1～6章のまとめ 1コマ［定着］')).toBe(true);
  });

  it('単元が多いときは切ったことを書く（黙って切らない）', () => {
    const many = {
      ...math,
      units: Array.from({ length: MAX_THEME_UNITS + 3 }, (_, i) => ({
        title: `単元${i}`,
        koma: 1,
        intent: null,
        reason: '',
      })),
    };
    expect(themeUserText([many])).toContain('残り3件は省略。やらないという意味ではない');
  });
});

describe('sanitizeThemeInputs', () => {
  it('配列でなければ空、単元の無い教科は捨てる', () => {
    expect(sanitizeThemeInputs(null)).toEqual([]);
    expect(sanitizeThemeInputs([{ key: 'eng', units: [] }])).toEqual([]);
  });

  it('コマ数を0〜20に収め、文字列でない値は落とす', () => {
    const [r] = sanitizeThemeInputs([
      { key: 'math', units: [{ title: 'x', koma: 99, intent: 3, reason: null }] },
    ]);
    expect(r.units[0]).toEqual({ title: 'x', koma: 20, intent: null, reason: '' });
  });
});

describe('parseThemeResult', () => {
  it('渡していない key と重複は捨て、改行を潰して長さを切る', () => {
    const raw = {
      themes: [
        { key: 'math', theme: '比例・反比例を\nやり直します（数学3コマ）' },
        { key: 'math', theme: '二つ目' },
        { key: 'sci', theme: '渡していない' },
      ],
    };
    expect(parseThemeResult(raw, [math])).toEqual([
      { key: 'math', theme: '比例・反比例を やり直します（数学3コマ）' },
    ]);
    const long = parseThemeResult({ themes: [{ key: 'math', theme: 'あ'.repeat(300) }] }, [math]);
    expect(long[0].theme.length).toBe(MAX_THEME_LENGTH);
  });

  it('形が違えば空（呼び出し側は「書けなかった」として欄を触らない）', () => {
    expect(parseThemeResult('x', [math])).toEqual([]);
    expect(parseThemeResult({ themes: [{ key: 'math', theme: '  ' }] }, [math])).toEqual([]);
  });
});
