import { describe, it, expect } from 'vitest';
import {
  validateForSubmit,
  type SubmitValidationInput,
} from '@/lib/lesson-reports/submitValidation';

/** すべて埋まっている状態（ここから1つずつ崩して境界を確かめる）。 */
const filled = (patch: Partial<SubmitValidationInput> = {}): SubmitValidationInput => ({
  hasTextbooks: true,
  selectedUnitCount: 1,
  extraMaterials: '',
  handover: '次回は分数係数から',
  reviewComment: '一次関数の変化の割合を確認しました。',
  ...patch,
});

const fields = (input: SubmitValidationInput) => validateForSubmit(input).map((i) => i.field);

describe('validateForSubmit（提出前チェック）', () => {
  it('3つとも埋まっていれば不足なし', () => {
    expect(validateForSubmit(filled())).toEqual([]);
  });

  it('必須はこの3つだけ（他の項目が空でも増やさない）', () => {
    // 進行表の教材があり単元も選ばれていれば、プリント自由記述は空でよい
    expect(validateForSubmit(filled({ extraMaterials: '' }))).toEqual([]);
  });
});

describe('本日の指導範囲', () => {
  it('進行表に教材がある生徒は、単元が1つも選ばれていないと不足', () => {
    expect(fields(filled({ hasTextbooks: true, selectedUnitCount: 0 }))).toEqual(['taught-range']);
  });

  it('進行表に教材がある生徒は、自由記述だけでは代替できない', () => {
    expect(
      fields(filled({ hasTextbooks: true, selectedUnitCount: 0, extraMaterials: 'プリント10問' }))
    ).toEqual(['taught-range']);
  });

  it('進行表に教材が無い生徒は、自由記述が埋まっていればOK', () => {
    expect(
      validateForSubmit(
        filled({ hasTextbooks: false, selectedUnitCount: 0, extraMaterials: 'プリント10問' })
      )
    ).toEqual([]);
  });

  it('進行表に教材が無い生徒で自由記述も空なら不足', () => {
    expect(
      fields(filled({ hasTextbooks: false, selectedUnitCount: 0, extraMaterials: '   ' }))
    ).toEqual(['taught-range']);
  });

  it('教材の有無でメッセージ（どこを埋めればよいか）が変わる', () => {
    const withTextbooks = validateForSubmit(filled({ selectedUnitCount: 0 }))[0];
    const withoutTextbooks = validateForSubmit(
      filled({ hasTextbooks: false, selectedUnitCount: 0 })
    )[0];
    expect(withTextbooks.message).toContain('進行表');
    expect(withoutTextbooks.message).toContain('プリント');
  });
});

describe('引継ぎ・講評', () => {
  it('引継ぎが空なら不足', () => {
    expect(fields(filled({ handover: '' }))).toEqual(['handover']);
  });

  it('講評が空なら不足', () => {
    expect(fields(filled({ reviewComment: '' }))).toEqual(['review']);
  });

  it('空白だけは空とみなす', () => {
    expect(fields(filled({ handover: '  \n ', reviewComment: '\t' }))).toEqual([
      'handover',
      'review',
    ]);
  });

  it('全部空なら3件を指導範囲→引継ぎ→講評の順で返す', () => {
    expect(fields(filled({ selectedUnitCount: 0, handover: '', reviewComment: '' }))).toEqual([
      'taught-range',
      'handover',
      'review',
    ]);
  });
});
