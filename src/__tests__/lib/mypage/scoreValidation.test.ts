import { describe, it, expect } from 'vitest';
import {
  isSubmittableCategory,
  validateScores,
  normalizeExamMonth,
  validateNameCode,
  isValidGrade,
} from '@/lib/mypage/scoreValidation';

/**
 * 保護者の成績申請バリデーションの境界テスト。
 * 正典: docs/portal-v2-requirements.md §7-5「値のバリデーション」。
 */
describe('isSubmittableCategory', () => {
  it('regular_test / report_card は true', () => {
    expect(isSubmittableCategory('regular_test')).toBe(true);
    expect(isSubmittableCategory('report_card')).toBe(true);
  });

  it('mock は false（保護者入力の対象外・§7-5の設計判断）', () => {
    expect(isSubmittableCategory('mock')).toBe(false);
  });

  it('未知の値・null・undefined は false', () => {
    expect(isSubmittableCategory('bogus')).toBe(false);
    expect(isSubmittableCategory(null)).toBe(false);
    expect(isSubmittableCategory(undefined)).toBe(false);
  });
});

describe('validateScores', () => {
  it('定期テスト: 0〜100の整数を許可する', () => {
    const res = validateScores('regular_test', { english: 0, math: 100, japanese: 82 });
    expect(res).toEqual({ ok: true, value: { english: 0, math: 100, japanese: 82 } });
  });

  it('内申: 1〜5の整数を許可する', () => {
    const res = validateScores('report_card', { english: 1, math: 5 });
    expect(res).toEqual({ ok: true, value: { english: 1, math: 5 } });
  });

  it('定期テストで範囲外（101）は拒否', () => {
    const res = validateScores('regular_test', { english: 101 });
    expect(res.ok).toBe(false);
  });

  it('定期テストで範囲外（-1）は拒否', () => {
    const res = validateScores('regular_test', { english: -1 });
    expect(res.ok).toBe(false);
  });

  it('内申で範囲外（0・6）は拒否', () => {
    expect(validateScores('report_card', { english: 0 }).ok).toBe(false);
    expect(validateScores('report_card', { english: 6 }).ok).toBe(false);
  });

  it('非整数（小数）は拒否', () => {
    const res = validateScores('regular_test', { english: 82.5 });
    expect(res.ok).toBe(false);
  });

  it('NaN・文字列・null は拒否', () => {
    expect(validateScores('regular_test', { english: NaN }).ok).toBe(false);
    expect(validateScores('regular_test', { english: '82' }).ok).toBe(false);
    expect(validateScores('regular_test', { english: null }).ok).toBe(false);
  });

  it('未知の科目キーは拒否（COMMON_9_SUBJECTS 以外）', () => {
    const res = validateScores('regular_test', { hensa_3: 50 });
    expect(res.ok).toBe(false);
  });

  it('空オブジェクトは拒否（1科目以上必須）', () => {
    const res = validateScores('regular_test', {});
    expect(res.ok).toBe(false);
  });

  it('オブジェクト以外（配列・文字列・null）は拒否', () => {
    expect(validateScores('regular_test', []).ok).toBe(false);
    expect(validateScores('regular_test', 'english:82').ok).toBe(false);
    expect(validateScores('regular_test', null).ok).toBe(false);
    expect(validateScores('regular_test', undefined).ok).toBe(false);
  });

  it('一部だけ不正なら全体を拒否する（部分的な取り込みをしない）', () => {
    const res = validateScores('regular_test', { english: 80, math: 999 });
    expect(res.ok).toBe(false);
  });
});

describe('normalizeExamMonth', () => {
  it('regular_test: YYYY-MM を YYYY-MM-01 に正規化する', () => {
    expect(normalizeExamMonth('2026-07', 'regular_test')).toEqual({
      ok: true,
      value: '2026-07-01',
    });
  });

  it('report_card: YYYY-MM を YYYY-MM-01 に正規化する', () => {
    expect(normalizeExamMonth('2026-01', 'report_card')).toEqual({ ok: true, value: '2026-01-01' });
  });

  it('report_card: null は許可（月を持たない運用がある）', () => {
    expect(normalizeExamMonth(null, 'report_card')).toEqual({ ok: true, value: null });
  });

  it('regular_test: null は拒否（テストには実施月がある前提）', () => {
    const res = normalizeExamMonth(null, 'regular_test');
    expect(res.ok).toBe(false);
  });

  it('不正な形式（YYYY-MM-DD・YYYY/MM・月13）は拒否', () => {
    expect(normalizeExamMonth('2026-07-01', 'regular_test').ok).toBe(false);
    expect(normalizeExamMonth('2026/07', 'regular_test').ok).toBe(false);
    expect(normalizeExamMonth('2026-13', 'regular_test').ok).toBe(false);
    expect(normalizeExamMonth('2026-00', 'regular_test').ok).toBe(false);
  });

  it('空文字は null と同様に扱う', () => {
    expect(normalizeExamMonth('', 'report_card')).toEqual({ ok: true, value: null });
    expect(normalizeExamMonth('', 'regular_test').ok).toBe(false);
  });
});

describe('validateNameCode', () => {
  it('regular_test の正当な code は true', () => {
    expect(validateNameCode('regular_test', 'term1_mid')).toBe(true);
    expect(validateNameCode('regular_test', 'year_end')).toBe(true);
  });

  it('report_card の正当な code は true', () => {
    expect(validateNameCode('report_card', 'term1')).toBe(true);
    expect(validateNameCode('report_card', 'first')).toBe(true);
  });

  it('カテゴリを跨いだ code は false（report_cardのcodeをregular_testに渡す等）', () => {
    expect(validateNameCode('regular_test', 'term1')).toBe(false);
    expect(validateNameCode('report_card', 'term1_mid')).toBe(false);
  });

  it("'legacy' は拒否する（過去データ移行用の逃がし値・新規申請では許さない）", () => {
    expect(validateNameCode('regular_test', 'legacy')).toBe(false);
    expect(validateNameCode('report_card', 'legacy')).toBe(false);
  });

  it('未知の文字列・非文字列は false', () => {
    expect(validateNameCode('regular_test', 'bogus')).toBe(false);
    expect(validateNameCode('regular_test', 123)).toBe(false);
    expect(validateNameCode('regular_test', null)).toBe(false);
  });
});

describe('isValidGrade', () => {
  it('1〜13の整数は true', () => {
    expect(isValidGrade(1)).toBe(true);
    expect(isValidGrade(13)).toBe(true);
    expect(isValidGrade(7)).toBe(true);
  });

  it('範囲外・非整数・非数値は false', () => {
    expect(isValidGrade(0)).toBe(false);
    expect(isValidGrade(14)).toBe(false);
    expect(isValidGrade(7.5)).toBe(false);
    expect(isValidGrade('7')).toBe(false);
    expect(isValidGrade(null)).toBe(false);
  });
});
