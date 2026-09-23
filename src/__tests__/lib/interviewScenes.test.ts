import { describe, it, expect } from 'vitest';
import {
  SCENE_KEYS,
  SCENE_LABEL,
  SCENE_OF_SECTION,
  ASK_LINES,
  HEARING_GROUP_KEYS,
  HEARING_GROUPS,
  HEARING_GROUP_OF_SECTION,
  hearingGroupOfSection,
  GRADE_BAND_LABEL,
  gradeBandOf,
  timingLines,
  timingQa,
  planRationaleLines,
  emptyTimingCells,
  isExamGrade,
  type GradeBand,
} from '@/lib/interview/scenes';
import { BRIEF_SECTIONS } from '@/lib/ai/interviewBrief';
import { stripNottaMeta, parseNottaSummary } from '@/app/interview/interview.shared';
import {
  examCountdownLine,
  examApplicationLine,
  nextExamDate,
  daysUntil,
} from '@/lib/interview/examDates';
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

  it('全シーンにラベルがある', () => {
    for (const key of SCENE_KEYS) {
      expect(SCENE_LABEL[key]).toBeTruthy();
    }
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

describe('②ヒアリングの小見出し', () => {
  it('振り返り → 学校 → 塾 → 家庭 の順（承認済みのモックの順）', () => {
    expect(HEARING_GROUP_KEYS).toEqual(['review', 'school', 'juku', 'home']);
    expect(HEARING_GROUP_KEYS.map((k) => HEARING_GROUPS[k].label)).toEqual([
      '振り返り',
      '学校',
      '塾',
      '家庭',
    ]);
  });

  it('★②に置いたセクションは全部どれかの小見出しに入る（入れ忘れると画面から消える）', () => {
    for (const s of BRIEF_SECTIONS) {
      if (SCENE_OF_SECTION[s.key] !== 'hearing') continue;
      expect(HEARING_GROUP_KEYS).toContain(hearingGroupOfSection(s.key));
    }
  });

  it('②以外のセクションは小見出しを持たない', () => {
    expect(hearingGroupOfSection('score')).toBeNull();
    expect(hearingGroupOfSection('koushu')).toBeNull();
  });

  it('セクションの振り分け（前回→振り返り／授業・宿題→塾／保護者→家庭）', () => {
    expect(HEARING_GROUP_OF_SECTION).toEqual({
      lastInterview: 'review',
      lessons: 'juku',
      discipline: 'juku',
      parent: 'home',
    });
  });

  it('聞くことは小見出しごとに持つ（学校のことは学校、家庭学習は家庭）', () => {
    expect(HEARING_GROUPS.school.ask).toEqual([
      '学校の授業と宿題の進み具合',
      '学校の面談で言われたこと',
      '学校生活の様子（部活動の引退後の過ごし方など）',
    ]);
    expect(HEARING_GROUPS.home.ask).toEqual([
      '家庭学習の様子。机に向かう時間は取れているか',
      '次の定期テスト・模試の目標を決める',
    ]);
    // ★②の聞くことを平たい ASK_LINES に戻さない（どの小見出しにも出ない行になる）
    expect(ASK_LINES.hearing).toBeUndefined();
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
    const tokyo = [...timingLines(9, 'winter', 'tokyo')];
    const kanagawa = [...timingLines(9, 'winter', 'kanagawa')];
    expect(tokyo.some((l) => l.includes('都立'))).toBe(true);
    expect(kanagawa.some((l) => l.includes('都立'))).toBe(false);
    // 想定問答のほうも混ざらない
    const tokyoQa = timingQa(9, 'winter', 'tokyo').map((x) => x.q + x.a);
    const kanagawaQa = timingQa(9, 'winter', 'kanagawa').map((x) => x.q + x.a);
    expect(kanagawaQa.some((l) => l.includes('打診値表'))).toBe(true);
    expect(tokyoQa.some((l) => l.includes('打診値表'))).toBe(false);
    expect(tokyoQa.some((l) => l.includes('Vもぎ'))).toBe(true);
    expect(kanagawaQa.some((l) => l.includes('Vもぎ'))).toBe(false);
  });

  it('★想定問答は共通 → 都県の順。共通の問は両方に出る', () => {
    const tokyo = timingQa(9, 'winter', 'tokyo');
    const kanagawa = timingQa(9, 'winter', 'kanagawa');
    const common = 'まだ受験生の意識が無いのですが、大丈夫ですか';
    expect(tokyo[0].q).toBe(common);
    expect(kanagawa[0].q).toBe(common);
    // 問と答が両方とも埋まっている（片方だけの行を作らない）
    for (const item of [...tokyo, ...kanagawa]) {
      expect(item.q.length).toBeGreaterThan(0);
      expect(item.a.length).toBeGreaterThan(0);
    }
  });

  it('用意されていない組み合わせの想定問答は空', () => {
    expect(timingQa(9, 'summer', 'tokyo')).toEqual([]);
    expect(timingQa(1, 'winter', 'tokyo')).toEqual([]);
    expect(timingQa(null, 'winter', 'tokyo')).toEqual([]);
  });

  it('共通の行は両方に出る', () => {
    const common = '受験間近。最後の追い込みの時期';
    expect(timingLines(9, 'winter', 'tokyo')).toContain(common);
    expect(timingLines(9, 'winter', 'kanagawa')).toContain(common);
  });

  it('★共通の行は前と後ろに分かれる。締めの言葉が話の2行目に来ない', () => {
    const lines = timingLines(9, 'winter', 'kanagawa');
    expect(lines[0]).toBe('受験間近。最後の追い込みの時期');
    // 都県の話は共通の前後に挟まれる
    expect(lines[1]).toContain('内申の大詰め');
    // 締めの「ご家庭へ」はすべて末尾にまとまる
    const tail = lines.slice(-3);
    expect(tail.every((l) => l.startsWith('ご家庭へ'))).toBe(true);
    expect(tail.some((l) => l.includes('体調管理'))).toBe(true);
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

describe('Nottaの要約を構造化する（parseNottaSummary）', () => {
  const notta = [
    '【タイトル】9/11 05:10 模試の成績と受験対策の相談',
    '【録音日時】2026/09/11 05:10',
    '【音声URL】https://app.notta.ai/7389587941842665472/dashboard/abc',
    '【参加者】教室長・保護者',
    '--- Notta 要約 ---',
    '■ 前回の確認',
    '・前回の面談に関する具体的な情報は会話の中で見つかりませんでした。',
    '',
    '■ 相談事項',
    '・高校選択が主なテーマ',
    '・法政と鎌倉学園の比較',
    '',
    '■ 次回への申し送り',
    '・志望校を小平と東大和南に絞る',
  ].join('\n');

  it('メタ行を落とし、見出しと箇条書きに割る', () => {
    const parsed = parseNottaSummary(notta);
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe('9/11 05:10 模試の成績と受験対策の相談');
    expect(parsed!.audioUrl).toBe('https://app.notta.ai/7389587941842665472/dashboard/abc');
    expect(parsed!.sections.map((s) => s.heading)).toEqual(['相談事項', '次回への申し送り']);
    expect(parsed!.sections[0].bullets).toEqual(['高校選択が主なテーマ', '法政と鎌倉学園の比較']);
  });

  it('★中身が「見つかりませんでした」等しか無い見出しは畳んで omitted に回す', () => {
    // 実物ではこの定型文が本文の半分を占める。出したままだと面談中に読めない
    const parsed = parseNottaSummary(notta);
    expect(parsed!.omitted).toEqual(['前回の確認']);
  });

  it('「確認できませんでした」「記載がありません」も空の言い回しとして畳む', () => {
    const parsed = parseNottaSummary(
      [
        '■ 塾からの報告',
        '・授業態度に関する具体的な報告は会話の中で確認できませんでした。',
        '■ 保護者からの要望',
        '・特段の記載がありません',
        '■ 相談事項',
        '・進路の相談',
      ].join('\n')
    );
    expect(parsed!.omitted).toEqual(['塾からの報告', '保護者からの要望']);
    expect(parsed!.sections.map((s) => s.heading)).toEqual(['相談事項']);
  });

  it('【見出し】形式（古いNottaの出力）も見出しとして扱う', () => {
    const parsed = parseNottaSummary(
      [
        '【塾からの報告】',
        '楽しく学習を進めたいという方針を説明',
        '【今後の方針】',
        '初回授業を実施',
      ].join('\n')
    );
    expect(parsed!.sections.map((s) => s.heading)).toEqual(['塾からの報告', '今後の方針']);
    expect(parsed!.sections[0].bullets).toEqual(['楽しく学習を進めたいという方針を説明']);
  });

  it('見出しが1つも無い本文（手入力の短い記録）は null', () => {
    expect(
      parseNottaSummary('夏期の進捗を報告。数学の関数を冬期に回す旨を了承いただいた')
    ).toBeNull();
  });

  it('メタ行しか無い本文も null（節に割れないものを無理に構造化しない）', () => {
    expect(parseNottaSummary('【タイトル】面談\n【録音日時】2026/08/03')).toBeNull();
  });

  it('★中身のある見出しに混ざった「発言はありません」等は、その1件だけ落とす', () => {
    // 小川 華佳さんの実物。要望の節に「無い」という箇条書きが混ざり、②で要望として読み上げていた
    const parsed = parseNottaSummary(
      [
        '■ 保護者からの要望',
        '・保護者からの明確な要望として確認できる発言はありません。',
        '・志望校選びの相談をしたい',
        '■ 前回の確認',
        '・前回の面談での約束事項について明確な記録は確認できません',
        '■ 相談事項',
        '・部活は特になし',
        '・進路の相談',
      ].join('\n')
    );
    expect(parsed!.sections.map((s) => s.heading)).toEqual(['保護者からの要望', '相談事項']);
    expect(parsed!.sections[0].bullets).toEqual(['志望校選びの相談をしたい']);
    expect(parsed!.sections[1].bullets).toEqual(['進路の相談']);
    // すべて落ちた見出しは従来どおり omitted へ
    expect(parsed!.omitted).toEqual(['前回の確認']);
  });

  it('★文末で当てる。文中に「ありませんでした」を含むだけの箇条書きは残す', () => {
    const parsed = parseNottaSummary(
      ['■ 塾からの報告', '・宿題は問題ありませんでしたが、英語の小テストが続けて低い'].join('\n')
    );
    expect(parsed!.sections[0].bullets).toEqual([
      '宿題は問題ありませんでしたが、英語の小テストが続けて低い',
    ]);
  });

  it('箇条書きが1件も無い見出しも「記載なし」に回す', () => {
    const parsed = parseNottaSummary(['■ 前回の確認', '■ 相談事項', '・進路の相談'].join('\n'));
    expect(parsed!.omitted).toEqual(['前回の確認']);
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

  it('★出願・取り下げの〆切は examDates.ts に持つ（定型トークに年度の日付を書かない）', () => {
    const t = new Date('2026-11-20');
    const line = examApplicationLine(t, 9, 'tokyo');
    expect(line).toContain('出願は 2/4 まで');
    expect(line).toContain('取り下げは 2/10');
  });

  it('★過ぎた〆切は出さない。面談は11月から2月まで続く', () => {
    // 出願は済んでいるが取り下げはまだ
    expect(examApplicationLine(new Date('2027-02-06'), 9, 'tokyo')).toBe(
      '★都立 ―― 志望変更の取り下げは 2/10'
    );
    // どちらも過ぎたら行そのものを出さない
    expect(examApplicationLine(new Date('2027-02-15'), 9, 'tokyo')).toBeNull();
  });

  it('★出願の〆切も神奈川・中3以外・登録の無い年度には出さない', () => {
    const t = new Date('2026-11-20');
    expect(examApplicationLine(t, 9, 'kanagawa')).toBeNull();
    expect(examApplicationLine(t, 8, 'tokyo')).toBeNull();
    expect(examApplicationLine(new Date('2028-11-20'), 9, 'tokyo')).toBeNull();
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
