/**
 * 単元の科目を解決するヘルパーのテスト。
 *
 * 過去問（1冊で全科目）のために科目を教材ではなく単元に持たせた。既存教材は単元の科目が
 * NULL なので、ここを通しても従来（教材の科目）と同じ答えになることを固定する。
 */
import { describe, it, expect } from 'vitest';
import {
  isAllSubjectTextbook,
  matchesSubjectFilter,
  matchesSubjectSelection,
  resolveUnitSubject,
} from '@/lib/curriculum/subject';

describe('resolveUnitSubject', () => {
  it('単元に科目があればそれを使う', () => {
    expect(resolveUnitSubject('英語', null)).toBe('英語');
    // 教材にも科目があっても単元が優先（過去問以外では起きない想定）
    expect(resolveUnitSubject('英語', '数学')).toBe('英語');
  });

  it('単元の科目が無ければ教材の科目（既存データは従来どおり）', () => {
    expect(resolveUnitSubject(null, '数学')).toBe('数学');
    expect(resolveUnitSubject(undefined, '数学')).toBe('数学');
    expect(resolveUnitSubject('  ', '数学')).toBe('数学');
  });

  it('どちらも無ければ空文字', () => {
    expect(resolveUnitSubject(null, null)).toBe('');
  });
});

describe('isAllSubjectTextbook', () => {
  it('教材の科目が空なら「1冊で全科目」扱い', () => {
    expect(isAllSubjectTextbook(null)).toBe(true);
    expect(isAllSubjectTextbook('')).toBe(true);
    expect(isAllSubjectTextbook('英語')).toBe(false);
  });
});

describe('matchesSubjectFilter', () => {
  it('絞り込み無しなら全部通す', () => {
    expect(matchesSubjectFilter('英語', '')).toBe(true);
    expect(matchesSubjectFilter(null, undefined)).toBe(true);
  });

  it('科目つきの教材は一致するものだけ', () => {
    expect(matchesSubjectFilter('英語', '英語')).toBe(true);
    expect(matchesSubjectFilter('英語', '数学')).toBe(false);
  });

  it('科目が空の教材（過去問）はどの科目で絞っても残る', () => {
    expect(matchesSubjectFilter(null, '数学')).toBe(true);
    expect(matchesSubjectFilter('', '国語')).toBe(true);
  });
});

describe('matchesSubjectSelection', () => {
  it('未選択なら全部通す', () => {
    expect(matchesSubjectSelection('英語', new Set())).toBe(true);
  });

  it('選んだ科目の教材と、科目が空の教材を通す', () => {
    const selected = new Set(['英語']);
    expect(matchesSubjectSelection('英語', selected)).toBe(true);
    expect(matchesSubjectSelection('数学', selected)).toBe(false);
    expect(matchesSubjectSelection(null, selected)).toBe(true);
  });
});
