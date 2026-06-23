import { describe, it, expect } from 'vitest';
import { calcTokyoNaishin, calcKanagawaNaishin, calcNaishin } from '@/lib/utils/convertedNaishin';

describe('calcTokyoNaishin - 都立換算内申', () => {
  it('全9科目オール5で65点満点', () => {
    const scores = {
      english: 5,
      math: 5,
      japanese: 5,
      social: 5,
      science: 5,
      music: 5,
      art: 5,
      tech_home: 5,
      pe: 5,
    };
    const result = calcTokyoNaishin(scores);
    // 5科×1=25, 実技4科×2=40, 合計65
    expect(result.five_subject_total).toBe(25);
    expect(result.four_subject_total).toBe(20);
    expect(result.converted).toBe(65);
    expect(result.max_score).toBe(65);
    expect(result.label).toBe('都立');
  });

  it('全9科目オール3で39点', () => {
    const scores = {
      english: 3,
      math: 3,
      japanese: 3,
      social: 3,
      science: 3,
      music: 3,
      art: 3,
      tech_home: 3,
      pe: 3,
    };
    const result = calcTokyoNaishin(scores);
    // 5科×1=15, 実技4科(12)×2=24, 合計39
    expect(result.five_subject_total).toBe(15);
    expect(result.four_subject_total).toBe(12);
    expect(result.converted).toBe(39);
  });

  it('5科目のみ（実技なし）の場合', () => {
    const scores: Record<string, number | null> = {
      english: 4,
      math: 5,
      japanese: 3,
      social: 4,
      science: 5,
      music: null,
      art: null,
      tech_home: null,
      pe: null,
    };
    const result = calcTokyoNaishin(scores);
    expect(result.five_subject_total).toBe(21);
    expect(result.four_subject_total).toBeNull();
    // 5科=21 + 実技0×2=0 → 21
    expect(result.converted).toBe(21);
  });

  it('実技4科のみ（5科なし）の場合', () => {
    const scores: Record<string, number | null> = {
      english: null,
      math: null,
      japanese: null,
      social: null,
      science: null,
      music: 4,
      art: 5,
      tech_home: 3,
      pe: 4,
    };
    const result = calcTokyoNaishin(scores);
    expect(result.five_subject_total).toBeNull();
    expect(result.four_subject_total).toBe(16);
    // 5科0 + 実技16×2=32
    expect(result.converted).toBe(32);
  });

  it('全科目nullの場合はconvertedもnull', () => {
    const scores: Record<string, number | null> = {
      english: null,
      math: null,
      japanese: null,
      social: null,
      science: null,
      music: null,
      art: null,
      tech_home: null,
      pe: null,
    };
    const result = calcTokyoNaishin(scores);
    expect(result.five_subject_total).toBeNull();
    expect(result.four_subject_total).toBeNull();
    expect(result.converted).toBeNull();
  });

  it('空のスコアオブジェクトの場合はconvertedがnull', () => {
    const result = calcTokyoNaishin({});
    expect(result.five_subject_total).toBeNull();
    expect(result.four_subject_total).toBeNull();
    expect(result.converted).toBeNull();
  });

  it('一部の科目のみ入力されている場合', () => {
    const scores: Record<string, number | null> = {
      english: 5,
      math: 4,
      music: 3,
    };
    const result = calcTokyoNaishin(scores);
    expect(result.five_subject_total).toBe(9); // 5+4
    expect(result.four_subject_total).toBe(3); // 3
    expect(result.converted).toBe(9 + 3 * 2); // 15
  });

  it('オール1の最低点の場合', () => {
    const scores = {
      english: 1,
      math: 1,
      japanese: 1,
      social: 1,
      science: 1,
      music: 1,
      art: 1,
      tech_home: 1,
      pe: 1,
    };
    const result = calcTokyoNaishin(scores);
    // 5科=5, 実技4=8, 合計13
    expect(result.five_subject_total).toBe(5);
    expect(result.four_subject_total).toBe(4);
    expect(result.converted).toBe(13);
  });
});

describe('calcKanagawaNaishin - 神奈川換算内申', () => {
  it('全9科目オール5で45点満点', () => {
    const scores = {
      english: 5,
      math: 5,
      japanese: 5,
      social: 5,
      science: 5,
      music: 5,
      art: 5,
      tech_home: 5,
      pe: 5,
    };
    const result = calcKanagawaNaishin(scores);
    expect(result.five_subject_total).toBe(25);
    expect(result.four_subject_total).toBe(20);
    expect(result.converted).toBe(45);
    expect(result.max_score).toBe(45);
    expect(result.label).toBe('神奈川');
  });

  it('全9科目オール3で27点', () => {
    const scores = {
      english: 3,
      math: 3,
      japanese: 3,
      social: 3,
      science: 3,
      music: 3,
      art: 3,
      tech_home: 3,
      pe: 3,
    };
    const result = calcKanagawaNaishin(scores);
    expect(result.converted).toBe(27);
  });

  it('全科目nullの場合はconvertedがnull', () => {
    const scores: Record<string, number | null> = {
      english: null,
      math: null,
      japanese: null,
      social: null,
      science: null,
      music: null,
      art: null,
      tech_home: null,
      pe: null,
    };
    const result = calcKanagawaNaishin(scores);
    expect(result.five_subject_total).toBeNull();
    expect(result.four_subject_total).toBeNull();
    expect(result.converted).toBeNull();
  });

  it('空のスコアオブジェクトの場合はconvertedがnull', () => {
    const result = calcKanagawaNaishin({});
    expect(result.converted).toBeNull();
  });

  it('一部の科目のみ入力の場合は入力分の合計', () => {
    const scores: Record<string, number | null> = {
      english: 5,
      math: 4,
      music: 3,
    };
    const result = calcKanagawaNaishin(scores);
    expect(result.five_subject_total).toBe(9);
    expect(result.four_subject_total).toBe(3);
    // 神奈川は単純合計
    expect(result.converted).toBe(12);
  });

  it('オール1の最低点の場合', () => {
    const scores = {
      english: 1,
      math: 1,
      japanese: 1,
      social: 1,
      science: 1,
      music: 1,
      art: 1,
      tech_home: 1,
      pe: 1,
    };
    const result = calcKanagawaNaishin(scores);
    expect(result.converted).toBe(9);
  });
});

describe('calcNaishin - 統合関数', () => {
  const fullScores = {
    english: 4,
    math: 5,
    japanese: 3,
    social: 4,
    science: 5,
    music: 3,
    art: 4,
    tech_home: 5,
    pe: 4,
  };

  it('type=tokyo で都立の計算結果を返す', () => {
    const result = calcNaishin(fullScores, 'tokyo');
    expect(result.label).toBe('都立');
    expect(result.max_score).toBe(65);
    // 5科=21, 実技4科=16, 換算=21+16*2=53
    expect(result.five_subject_total).toBe(21);
    expect(result.four_subject_total).toBe(16);
    expect(result.converted).toBe(53);
  });

  it('type=kanagawa で神奈川の計算結果を返す', () => {
    const result = calcNaishin(fullScores, 'kanagawa');
    expect(result.label).toBe('神奈川');
    expect(result.max_score).toBe(45);
    // 9科合計=37
    expect(result.converted).toBe(37);
  });
});
