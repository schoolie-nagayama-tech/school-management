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
  // ★本番の評価科目マスタどおりの名前。中学の社会は括弧付きで、ラベル「社会」とは一致しない
  { code: 'jhs_social_civics', name: '社会(公民)', school_type: '中学' },
  { code: 'hs_math_1', name: '数学Ⅰ', school_type: '高校' },
  { code: 'hs_eng_com_1', name: '英語コミュニケーションⅠ', school_type: '高校' },
  { code: 'elem_english', name: '外国語(英語)', school_type: '小学' },
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

  it('小学の算数は、小学のコードも同じ系統のコードも拾う', () => {
    const keys = subjectKeysForLabel('算数', '小学', MASTERS);
    expect(keys.has('elem_math')).toBe(true);
    // ★同じ系統は学校種別を問わず入れる。見るのはその生徒の行だけなので、
    //   小学生に jhs_math の行は無く、拾いすぎても害が無い。
    //   逆に絞ると、本番で成績が旧コード 'math' のまま入っている小学生を落とす。
    expect(keys.has('math')).toBe(true);
    // 別の科目まで広がっていないことは確かめる
    expect(keys.has('english')).toBe(false);
    expect(keys.has('jhs_japanese')).toBe(false);
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

  // ★ここから下は本番データで確かめたもの。
  //   マスタと旧コードの2枚では当たらず、提案書172件のうち28件が「記録なし」で送られていた。
  it('高校の教材「数学」から、割れている履修科目のコードを拾う', () => {
    const keys = subjectKeysForLabel('数学', '高校', MASTERS);
    // マスタの name は「数学Ⅰ」なので、ラベル「数学」との等号では当たらない
    expect(keys.has('hs_math_1')).toBe(true);
    expect(keys.has('hs_math_a')).toBe(true);
    expect(keys.has('hs_math_3')).toBe(true);
  });

  it('高校の教材「英語」から、英コ・論表のコードを拾う', () => {
    const keys = subjectKeysForLabel('英語', '高校', MASTERS);
    expect(keys.has('hs_eng_com_1')).toBe(true);
    expect(keys.has('hs_logic_expr_1')).toBe(true);
  });

  it('高校の教材「国語」「理科」「社会」も系統で拾う', () => {
    expect(subjectKeysForLabel('国語', '高校', MASTERS).has('hs_gendai_kokugo')).toBe(true);
    expect(subjectKeysForLabel('理科', '高校', MASTERS).has('hs_chem_basic')).toBe(true);
    expect(subjectKeysForLabel('社会', '高校', MASTERS).has('hs_rekishi_sogo')).toBe(true);
  });

  it('中学の「社会」は、マスタの名前が「社会(地理)」でも3コードとも拾う', () => {
    const keys = subjectKeysForLabel('社会', '中学', MASTERS);
    expect(keys.has('jhs_social_geo')).toBe(true);
    expect(keys.has('jhs_social_history')).toBe(true);
    expect(keys.has('jhs_social_civics')).toBe(true);
    expect(keys.has('social')).toBe(true); // 本番に実在するのはこの旧コード
  });

  it('教材が「算数」でも、成績側の旧コード math を拾う', () => {
    // ★本番の小学・中学の成績は今も 'math' で入っている（elem_math は0件）
    expect(subjectKeysForLabel('算数', '小学', MASTERS).has('math')).toBe(true);
    // ★中学生なのに教材の科目が「算数」という提案書が本番に2件ある。学校種別で落とさない
    expect(subjectKeysForLabel('算数', '中学', MASTERS).has('math')).toBe(true);
  });

  it('小学の英語は外国語(英語)を拾うが、外国語活動は拾わない', () => {
    const keys = subjectKeysForLabel('英語', '小学', MASTERS);
    expect(keys.has('elem_english')).toBe(true);
    // ★外国語活動を英語の成績として読ませない（持っていない成績に触れたのと同じになる）
    expect(keys.has('elem_eng_activity')).toBe(false);
  });

  it('系統の表があっても、科目が空なら何も拾わない', () => {
    expect(subjectKeysForLabel('', '高校', MASTERS).size).toBe(0);
  });

  it('学年が分からないときは学校種別で絞らない', () => {
    const keys = subjectKeysForLabel('英語', null, MASTERS);
    expect(keys.has('jhs_english')).toBe(true);
    expect(keys.has('high_english')).toBe(true);
  });
});
