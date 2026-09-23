import { describe, it, expect } from 'vitest';
import {
  calcTokyoNaishin,
  calcKanagawaNaishin,
  calcKanagawaNaishin135,
  calcNaishin,
} from '@/lib/utils/convertedNaishin';

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

describe('calcKanagawaNaishin135 - 神奈川県公立の内申（中2学年末×1＋中3×2＝135点満点）', () => {
  /** 9教科を同じ値で埋める。override で個別に変える */
  function nine(v: number, override: Record<string, number | null> = {}) {
    return {
      english: v,
      math: v,
      japanese: v,
      social: v,
      science: v,
      music: v,
      art: v,
      tech_home: v,
      pe: v,
      ...override,
    };
  }

  it('オール5なら135点満点', () => {
    const r = calcKanagawaNaishin135(
      { nameCode: 'year_end', scores: nine(5) },
      { nameCode: 'term2', scores: nine(5) }
    );
    expect(r).toEqual({
      converted: 135,
      grade8Total: 45,
      grade9Total: 45,
      max_score: 135,
      provisional: false,
      label: '換算内申',
    });
  });

  it('中2×1＋中3×2で計算する（中2=27・中3=36 → 27+72=99）', () => {
    const r = calcKanagawaNaishin135(
      { nameCode: 'year_end', scores: nine(3) },
      { nameCode: 'term2', scores: nine(4) }
    );
    expect(r?.converted).toBe(99);
    expect(r?.grade8Total).toBe(27);
    expect(r?.grade9Total).toBe(36);
  });

  it('中2と中3を取り違えない（重いのは中3）', () => {
    const a = calcKanagawaNaishin135(
      { nameCode: 'year_end', scores: nine(5) },
      { nameCode: 'term2', scores: nine(3) }
    );
    const b = calcKanagawaNaishin135(
      { nameCode: 'year_end', scores: nine(3) },
      { nameCode: 'term2', scores: nine(5) }
    );
    expect(a?.converted).toBe(45 + 54);
    expect(b?.converted).toBe(27 + 90);
  });

  it('2期制の後期（second）も確定扱い', () => {
    const r = calcKanagawaNaishin135(
      { nameCode: 'second', scores: nine(4) },
      { nameCode: 'second', scores: nine(4) }
    );
    expect(r?.converted).toBe(108);
    expect(r?.provisional).toBe(false);
  });

  it('中3の学年末（year_end）も確定扱い', () => {
    const r = calcKanagawaNaishin135(
      { nameCode: 'year_end', scores: nine(4) },
      { nameCode: 'year_end', scores: nine(4) }
    );
    expect(r?.provisional).toBe(false);
  });

  it('★中3が1学期（term1）だけなら計算はするが暫定', () => {
    const r = calcKanagawaNaishin135(
      { nameCode: 'year_end', scores: nine(3) },
      { nameCode: 'term1', scores: nine(4) }
    );
    expect(r?.converted).toBe(99);
    expect(r?.provisional).toBe(true);
    expect(r?.label).toBe('換算内申（中3は1学期の評定で仮計算）');
  });

  it('★中3が前期（first）だけでも暫定', () => {
    const r = calcKanagawaNaishin135(
      { nameCode: 'second', scores: nine(3) },
      { nameCode: 'first', scores: nine(3) }
    );
    expect(r?.converted).toBe(81);
    expect(r?.provisional).toBe(true);
  });

  it('中2学年末が無ければ null（推測しない）', () => {
    expect(calcKanagawaNaishin135(null, { nameCode: 'term2', scores: nine(4) })).toBeNull();
    expect(calcKanagawaNaishin135(undefined, { nameCode: 'term2', scores: nine(4) })).toBeNull();
  });

  it('中3が無ければ null', () => {
    expect(calcKanagawaNaishin135({ nameCode: 'year_end', scores: nine(4) }, null)).toBeNull();
  });

  it('★9教科のどれか1つでも欠けたら null（平均で埋めない）', () => {
    expect(
      calcKanagawaNaishin135(
        { nameCode: 'year_end', scores: nine(4, { pe: null }) },
        { nameCode: 'term2', scores: nine(4) }
      )
    ).toBeNull();
    // 教科そのものが無い（キーが無い）場合も欠けとして扱う
    const withoutArt: Record<string, number | null> = nine(4);
    delete withoutArt.art;
    expect(
      calcKanagawaNaishin135(
        { nameCode: 'year_end', scores: nine(4) },
        { nameCode: 'term2', scores: withoutArt }
      )
    ).toBeNull();
  });

  it('想定外の name_code（定期テストの term2_final など）は null', () => {
    expect(
      calcKanagawaNaishin135(
        { nameCode: 'year_end', scores: nine(4) },
        { nameCode: 'term2_final', scores: nine(4) }
      )
    ).toBeNull();
  });

  it('既存の calcKanagawaNaishin（1行・45点満点）は挙動を変えていない', () => {
    expect(calcKanagawaNaishin(nine(4)).converted).toBe(36);
    expect(calcKanagawaNaishin(nine(4)).max_score).toBe(45);
  });
});
