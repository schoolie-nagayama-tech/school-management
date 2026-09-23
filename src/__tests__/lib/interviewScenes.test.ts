import { describe, it, expect } from 'vitest';
import {
  SCENE_KEYS,
  SCENE_LABEL,
  SCENE_OPEN_BY_DEFAULT,
  SCENE_OF_SECTION,
  GRADE_BAND_LABEL,
  gradeBandOf,
  timingLines,
  planRationaleLines,
  emptyTimingCells,
  isExamGrade,
  type GradeBand,
} from '@/lib/interview/scenes';
import { BRIEF_SECTIONS } from '@/lib/ai/interviewBrief';
import { stripNottaMeta } from '@/app/interview/interview.shared';
import { examCountdownLine, nextExamDate, daysUntil } from '@/lib/interview/examDates';
import { regionOfSchool } from '@/lib/interview/region';

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
    const lines = timingLines(9, 'summer', 'tokyo');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('7〜8月'))).toBe(true);
  });

  it('★まだ書かれていないマスは空を返す（埋め草を書かない）', () => {
    expect(timingLines(1, 'summer', 'tokyo')).toEqual([]); // 小学生はまだ書いていない
    expect(timingLines(10, 'winter', 'tokyo')).toEqual([]); // 高1・高2も
  });

  it('区分が取れない学年は空', () => {
    expect(timingLines(13, 'summer', 'tokyo')).toEqual([]);
    expect(timingLines(null, 'summer', 'tokyo')).toEqual([]);
  });

  it('★都県で中身が変わる。東京の制度の話が神奈川に出ない', () => {
    const tokyo = timingLines(9, 'winter', 'tokyo');
    const kanagawa = timingLines(9, 'winter', 'kanagawa');
    expect(tokyo.some((l) => l.includes('都立'))).toBe(true);
    expect(kanagawa.some((l) => l.includes('都立'))).toBe(false);
    expect(kanagawa.some((l) => l.includes('打診値表'))).toBe(true);
    expect(tokyo.some((l) => l.includes('打診値表'))).toBe(false);
  });

  it('共通の行は両方に出る', () => {
    const common = '受験間近。最後の追い込みの時期';
    expect(timingLines(9, 'winter', 'tokyo')).toContain(common);
    expect(timingLines(9, 'winter', 'kanagawa')).toContain(common);
  });

  it('★共通の行は前と後ろに分かれる。締めの言葉が話の2行目に来ない', () => {
    const lines = timingLines(9, 'winter', 'kanagawa');
    expect(lines[0]).toBe('受験間近。最後の追い込みの時期');
    expect(lines[lines.length - 1]).toContain('体調管理');
    // 都県の話は共通の前後に挟まれる
    expect(lines[1]).toContain('内申の大詰め');
  });

  it('★教室が未登録（region=null）でも共通の行だけは出る', () => {
    const lines = timingLines(9, 'winter', null);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('都立'))).toBe(false);
    expect(lines.some((l) => l.includes('打診値表'))).toBe(false);
  });

  it('★③の教科別の行は⑤にもそのまま出る（出どころが1つ）', () => {
    const timing = timingLines(9, 'winter', 'kanagawa');
    const plan = planRationaleLines(9, 'winter', 'kanagawa');
    expect(plan.length).toBeGreaterThan(0);
    // ⑤に出る行はすべて③にも出ている。片方だけ直すと面談の中で食い違う
    for (const line of plan) expect(timing).toContain(line);
  });

  it('⑤の根拠が用意されていない組み合わせは空', () => {
    expect(planRationaleLines(9, 'winter', 'tokyo')).toEqual([]);
    expect(planRationaleLines(9, 'summer', 'kanagawa')).toEqual([]);
    expect(planRationaleLines(9, 'winter', null)).toEqual([]);
    expect(planRationaleLines(null, 'winter', 'kanagawa')).toEqual([]);
  });

  it('★中3・冬期は2期制と3学期制を併記する（緑園学園は2期制だが3学期制の学校もある）', () => {
    const lines = timingLines(9, 'winter', 'kanagawa');
    expect(lines.some((l) => l.includes('2学期（2期制なら前期）'))).toBe(true);
    expect(lines.some((l) => l.includes('仮内申'))).toBe(true);
  });

  it('未記入のマスを数えられる（記入シートの進み具合を見るため）', () => {
    const empty = emptyTimingCells();
    // 2都県 × 5区分 × 3季節 = 30マス。
    // 東京=中1・中2の夏冬＋中3の3期で5マス、神奈川=中3・冬期の1マスが記入済み
    expect(empty).toHaveLength(24);
    expect(
      empty.some((c) => c.region === 'tokyo' && c.band === 'junior3' && c.season === 'summer')
    ).toBe(false);
    expect(
      empty.some((c) => c.region === 'kanagawa' && c.band === 'junior3' && c.season === 'winter')
    ).toBe(false);
    // ★神奈川の中3・夏期はまだ無い（東京の行が流用されていないことの裏取り）
    expect(
      empty.some((c) => c.region === 'kanagawa' && c.band === 'junior3' && c.season === 'summer')
    ).toBe(true);
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
    expect(examCountdownLine(t, 9, 'tokyo')).toMatch(/都立一次（2\/21）まで あと\d+日/);
    expect(examCountdownLine(t, 8, 'tokyo')).toBeNull();
    expect(examCountdownLine(t, 12, 'tokyo')).toBeNull(); // 高3は都立入試ではない
    expect(examCountdownLine(t, null, 'tokyo')).toBeNull();
  });

  it('★神奈川（緑園都市校）にも出す。日付は共通選抜の学力検査 2/16', () => {
    const t = new Date('2026-09-22');
    expect(examCountdownLine(t, 9, 'kanagawa')).toMatch(/共通選抜（2\/16）まで あと\d+日/);
    expect(examCountdownLine(t, 8, 'kanagawa')).toBeNull();
    expect(examCountdownLine(t, null, 'kanagawa')).toBeNull();
  });

  it('★呼び名を都県で変える。神奈川に「都立一次」と出すと面談が事故る', () => {
    const t = new Date('2026-09-22');
    expect(examCountdownLine(t, 9, 'kanagawa')).not.toContain('都立');
    expect(examCountdownLine(t, 9, 'tokyo')).not.toContain('共通選抜');
  });

  it('★都県が分からない教室には出さない。どちらの入試か言えない日数は害になる', () => {
    expect(examCountdownLine(new Date('2026-09-22'), 9, null)).toBeNull();
    expect(nextExamDate(new Date('2026-09-22'), 9, null)).toBeNull();
  });

  it('学年度は4月始まり。9月の中3は翌年2月の入試を見る', () => {
    expect(nextExamDate(new Date('2026-09-22'), 9, 'tokyo')).toBe('2027-02-21');
    expect(nextExamDate(new Date('2026-09-22'), 9, 'kanagawa')).toBe('2027-02-16');
    // 1〜3月はその年度の入試（＝同じ年の2月）
    expect(nextExamDate(new Date('2027-01-10'), 9, 'tokyo')).toBe('2027-02-21');
    expect(nextExamDate(new Date('2027-01-10'), 9, 'kanagawa')).toBe('2027-02-16');
  });

  it('★登録の無い年度は null。当て推量の日付を出さない', () => {
    expect(nextExamDate(new Date('2028-09-01'), 9, 'tokyo')).toBeNull();
    expect(nextExamDate(new Date('2028-09-01'), 9, 'kanagawa')).toBeNull();
    expect(examCountdownLine(new Date('2028-09-01'), 9, 'tokyo')).toBeNull();
    expect(examCountdownLine(new Date('2028-09-01'), 9, 'kanagawa')).toBeNull();
  });

  it('★入試日を過ぎたら出さない。神奈川は 2/16、東京は 2/21 と消える日が違う', () => {
    expect(examCountdownLine(new Date('2027-02-16'), 9, 'kanagawa')).toMatch(/あと0日/);
    expect(examCountdownLine(new Date('2027-02-17'), 9, 'kanagawa')).toBeNull();
    // 神奈川が終わった日でも、東京はまだ 2/21 が残っている
    expect(examCountdownLine(new Date('2027-02-17'), 9, 'tokyo')).toMatch(/あと4日/);
  });

  it('日数の計算', () => {
    expect(daysUntil(new Date('2027-02-21'), '2027-02-21')).toBe(0);
    expect(daysUntil(new Date('2027-02-20'), '2027-02-21')).toBe(1);
  });
});

describe('教室から都県を引く', () => {
  it('緑園都市校は神奈川県、他の3校は東京都', () => {
    expect(regionOfSchool('9a6b5996-a266-47ed-878f-85e93c2b8b90')).toBe('kanagawa');
    expect(regionOfSchool('9f519794-3673-4e90-b1ea-88a79f70174a')).toBe('tokyo');
    expect(regionOfSchool('d187f7a3-633a-46ce-8d32-c56c85d17bac')).toBe('tokyo');
    expect(regionOfSchool('e26b398c-8e30-47bc-b528-ee92fd45be7f')).toBe('tokyo');
  });

  it('★未登録の教室は null。既定を東京にしない（神奈川に都立の話が出てしまう）', () => {
    expect(regionOfSchool('00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(regionOfSchool(null)).toBeNull();
    expect(regionOfSchool(undefined)).toBeNull();
  });
});
