import { describe, it, expect } from 'vitest';
import {
  SCENE_KEYS,
  SCENE_LABEL,
  SCENE_OPEN_BY_DEFAULT,
  SCENE_OF_SECTION,
  GRADE_BAND_LABEL,
  gradeBandOf,
  timingLines,
  emptyTimingCells,
  isExamGrade,
  type GradeBand,
} from '@/lib/interview/scenes';
import { BRIEF_SECTIONS } from '@/lib/ai/interviewBrief';
import { stripNottaMeta } from '@/app/interview/interview.shared';
import { examCountdownLine, nextTokyoExamDate, daysUntil } from '@/lib/interview/examDates';

describe('面談のシーン定義', () => {
  it('7シーンが本部チェックリストの順に並ぶ', () => {
    expect(SCENE_KEYS).toEqual([
      'intro',
      'hearing',
      'timing',
      'status',
      'plan',
      'apply',
      'closing',
    ]);
  });

  it('全シーンにラベルと既定の開閉がある', () => {
    for (const key of SCENE_KEYS) {
      expect(SCENE_LABEL[key]).toBeTruthy();
      expect(typeof SCENE_OPEN_BY_DEFAULT[key]).toBe('boolean');
    }
  });

  it('★定型の①③⑦は閉じ、生徒ごとに変わる②④⑤⑥は開く', () => {
    // 全部開くと縦に長くなって読まれない。ここが逆になると設計意図が失われる
    expect(SCENE_OPEN_BY_DEFAULT.intro).toBe(false);
    expect(SCENE_OPEN_BY_DEFAULT.timing).toBe(false);
    expect(SCENE_OPEN_BY_DEFAULT.closing).toBe(false);
    expect(SCENE_OPEN_BY_DEFAULT.hearing).toBe(true);
    expect(SCENE_OPEN_BY_DEFAULT.status).toBe(true);
    expect(SCENE_OPEN_BY_DEFAULT.plan).toBe(true);
    expect(SCENE_OPEN_BY_DEFAULT.apply).toBe(true);
  });

  it('★AIに渡すセクションが全部どれかのシーンに割り当たっている', () => {
    // 割り当て漏れがあると、そのセクションは画面のどこにも出ない（黙って消える）
    for (const s of BRIEF_SECTIONS) {
      expect(SCENE_KEYS).toContain(SCENE_OF_SECTION[s.key]);
    }
  });

  it('セクションが置かれるのは②④⑤の3シーンだけ（①③⑥⑦はAIを使わない）', () => {
    const used = new Set(Object.values(SCENE_OF_SECTION));
    expect([...used].sort()).toEqual(['hearing', 'plan', 'status']);
  });
});

describe('学年の区分', () => {
  it.each<[number, GradeBand]>([
    [1, 'elementary'],
    [6, 'elementary'],
    [7, 'junior12'],
    [8, 'junior12'],
    [9, 'junior3'],
    [10, 'high12'],
    [11, 'high12'],
    [12, 'high3'],
  ])('学年 %i は %s', (grade, band) => {
    expect(gradeBandOf(grade)).toBe(band);
  });

  it('★13（既卒）と未設定は区分なし。面談の型が違うので定型を出さない', () => {
    expect(gradeBandOf(13)).toBeNull();
    expect(gradeBandOf(null)).toBeNull();
  });

  it('全区分にラベルがある', () => {
    for (const band of Object.keys(GRADE_BAND_LABEL) as GradeBand[]) {
      expect(GRADE_BAND_LABEL[band]).toBeTruthy();
    }
  });

  it('受験学年は中3と高3だけ', () => {
    expect(isExamGrade(9)).toBe(true);
    expect(isExamGrade(12)).toBe(true);
    expect(isExamGrade(8)).toBe(false);
    expect(isExamGrade(13)).toBe(false);
    expect(isExamGrade(null)).toBe(false);
  });
});

describe('③時期の重要性の定型トーク', () => {
  it('中3・夏期は本部チェックリストから起こした行が入っている', () => {
    const lines = timingLines(9, 'summer');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('7〜8月'))).toBe(true);
  });

  it('★まだ書かれていないマスは空を返す（埋め草を書かない）', () => {
    expect(timingLines(1, 'summer')).toEqual([]); // 小学生はまだ書いていない
    expect(timingLines(10, 'winter')).toEqual([]); // 高1・高2も
  });

  it('区分が取れない学年は空', () => {
    expect(timingLines(13, 'summer')).toEqual([]);
    expect(timingLines(null, 'summer')).toEqual([]);
  });

  it('未記入のマスを数えられる（記入シートの進み具合を見るため）', () => {
    const empty = emptyTimingCells();
    // 5区分 × 3季節 = 15マス。中1・中2の夏冬と中3の3期が記入済み
    expect(empty).toHaveLength(10);
    expect(empty.some((c) => c.band === 'junior3' && c.season === 'summer')).toBe(false);
  });
});

describe('Nottaのメタ情報を落とす', () => {
  const notta = [
    '【タイトル】7/31 14:58 一次関数の学習進捗に関する保護者面談',
    '【録音日時】2026/08/03 19:23',
    '【音声URL】https://app.notta.ai/7389587941842665472/dashboard/abc',
    '--- Notta 要約 ---',
    '■ 前回の確認',
    '・一次関数の予習授業を実施',
  ].join('\n');

  it('★要約の見出し以降だけを返す（録音日時とURLで面談の行が埋まらないように）', () => {
    const out = stripNottaMeta(notta);
    expect(out).not.toContain('録音日時');
    expect(out).not.toContain('app.notta.ai');
    expect(out.startsWith('■ 前回の確認')).toBe(true);
  });

  it('要約の見出しが無ければ最初の■から返す', () => {
    const noSummary = notta.replace('--- Notta 要約 ---\n', '');
    expect(stripNottaMeta(noSummary).startsWith('■ 前回の確認')).toBe(true);
  });

  it('■も無ければメタ行だけを落とす', () => {
    const plain = [
      '【タイトル】面談',
      '【録音日時】2026/08/03',
      '保護者から進路の相談があった',
    ].join('\n');
    expect(stripNottaMeta(plain)).toBe('保護者から進路の相談があった');
  });

  it('Nottaでない普通の本文はそのまま返す', () => {
    expect(stripNottaMeta('数学の復習を家でも続けることになった')).toBe(
      '数学の復習を家でも続けることになった'
    );
  });

  it('メタ行しかなければ元の本文を返す（空にして情報を失わない）', () => {
    const onlyMeta = '【タイトル】面談\n【録音日時】2026/08/03';
    expect(stripNottaMeta(onlyMeta)).toBe(onlyMeta);
  });
});

describe('入試までの日数', () => {
  it('★中3のときだけ出す。中1・中2に「あと900日」は面談で使わない', () => {
    const t = new Date('2026-09-22');
    expect(examCountdownLine(t, 9)).toMatch(/都立一次（2\/21）まで あと\d+日/);
    expect(examCountdownLine(t, 8)).toBeNull();
    expect(examCountdownLine(t, 12)).toBeNull(); // 高3は都立入試ではない
    expect(examCountdownLine(t, null)).toBeNull();
  });

  it('学年度は4月始まり。9月の中3は翌年2月の入試を見る', () => {
    expect(nextTokyoExamDate(new Date('2026-09-22'), 9)).toBe('2027-02-21');
    // 1〜3月はその年度の入試（＝同じ年の2月）
    expect(nextTokyoExamDate(new Date('2027-01-10'), 9)).toBe('2027-02-21');
  });

  it('★登録の無い年度は null。当て推量の日付を出さない', () => {
    expect(nextTokyoExamDate(new Date('2028-09-01'), 9)).toBeNull();
    expect(examCountdownLine(new Date('2028-09-01'), 9)).toBeNull();
  });

  it('日数の計算', () => {
    expect(daysUntil(new Date('2027-02-21'), '2027-02-21')).toBe(0);
    expect(daysUntil(new Date('2027-02-20'), '2027-02-21')).toBe(1);
  });
});
