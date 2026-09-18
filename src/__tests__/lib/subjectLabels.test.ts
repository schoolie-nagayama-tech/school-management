/**
 * 模試の科目コードに表示名があることを固定する。
 *
 * SUBJECT_LABELS に無いコードは、アラートで「hensa_3 -6pt」のようにコード名が
 * そのまま利用者に出る（本番のアラートで発生）。模試だけ科目構成が別なので漏れやすい。
 */
import { describe, it, expect } from 'vitest';
import { SUBJECT_LABELS } from '@/types/database';

// src/lib/api/assessments.ts の MOCK_SUBJECTS と対。増やしたらこちらも足すこと。
const MOCK_SUBJECT_CODES = [
  'english',
  'math',
  'japanese',
  'social',
  'science',
  'hensa_3',
  'hensa_5',
];

describe('SUBJECT_LABELS', () => {
  it('模試で使う科目コードにはすべて表示名がある', () => {
    const missing = MOCK_SUBJECT_CODES.filter((code) => !SUBJECT_LABELS[code]);
    expect(missing).toEqual([]);
  });

  it('偏差値の手入力欄は科目名と区別できるラベルになっている', () => {
    expect(SUBJECT_LABELS['hensa_3']).toBe('3科偏差値');
    expect(SUBJECT_LABELS['hensa_5']).toBe('5科偏差値');
  });
});
