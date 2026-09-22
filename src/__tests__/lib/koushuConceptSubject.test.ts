/**
 * 教材の科目（日本語ラベル）と、成績の科目（コード）の突き合わせ。
 *
 * ★ここが噛み合っていなかったせいで、テーマふくらませは一度も成績を見ていなかった。
 *   等号で比べると 'English' ではなく '英語' vs 'jhs_english' になる。
 */

import { describe, it, expect } from 'vitest';
import { schoolTypeOfGrade, subjectKeysForLabel } from '@/lib/ai/koushuConcept';

const MASTERS = [
  { code: 'elem_math', name: '算数', school_type: '小学' },
  { code: 'elem_eng_activity', name: '外国語活動', school_type: '小学' },
  { code: 'jhs_english', name: '英語', school_type: '中学' },
  { code: 'jhs_math', name: '数学', school_type: '中学' },
  { code: 'jhs_social_geo', name: '社会(地理)', school_type: '中学' },
  { code: 'jhs_social_history', name: '社会(歴史)', school_type: '中学' },
  { code: 'high_english', name: '英語', school_type: '高校' },
  { code: 'common_note', name: '英語', school_type: '共通' },
];

describe('schoolTypeOfGrade', () => {
  it('学年から学校種別を出す', () => {
    expect(schoolTypeOfGrade(6)).toBe('小学');
    expect(schoolTypeOfGrade(7)).toBe('中学');
    expect(schoolTypeOfGrade(9)).toBe('中学');
    expect(schoolTypeOfGrade(10)).toBe('高校');
    expect(schoolTypeOfGrade(null)).toBeNull();
  });
});

describe('subjectKeysForLabel', () => {
  it('中学英語は、その学校種別のコードと旧コードとラベルを拾う', () => {
    const keys = subjectKeysForLabel('英語', '中学', MASTERS);
    expect(keys.has('jhs_english')).toBe(true);
    expect(keys.has('english')).toBe(true); // 旧コード（SUBJECT_LABELS の逆引き）
    expect(keys.has('英語')).toBe(true); // 日本語のまま入っている古いデータ
    expect(keys.has('common_note')).toBe(true); // 「共通」は学校種別を問わず拾う
    expect(keys.has('high_english')).toBe(false); // 別の学校種別は拾わない
  });

  it('小学の算数は小学のコードを拾う', () => {
    const keys = subjectKeysForLabel('算数', '小学', MASTERS);
    expect(keys.has('elem_math')).toBe(true);
    expect(keys.has('jhs_math')).toBe(false);
  });

  it('評価科目マスタが引けなくても、旧コードとラベルは残る', () => {
    const keys = subjectKeysForLabel('数学', '中学', []);
    expect(keys.has('math')).toBe(true);
    expect(keys.has('数学')).toBe(true);
  });

  it('教材の科目が空（過去問など）なら何も拾わない', () => {
    expect(subjectKeysForLabel('', '中学', MASTERS).size).toBe(0);
    expect(subjectKeysForLabel('  ', '中学', MASTERS).size).toBe(0);
  });

  it('学年が分からないときは学校種別で絞らない', () => {
    const keys = subjectKeysForLabel('英語', null, MASTERS);
    expect(keys.has('jhs_english')).toBe(true);
    expect(keys.has('high_english')).toBe(true);
  });
});
