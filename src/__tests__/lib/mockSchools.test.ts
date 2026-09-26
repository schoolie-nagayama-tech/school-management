import { describe, it, expect } from 'vitest';
import {
  formatPossibility,
  matchMockSchoolName,
  mockSchoolShortName,
  parsePossibility,
  readMockSchoolPairs,
  splitMockSchoolName,
  type HighSchoolKeyRow,
} from '@/lib/scores/mockSchools';
import { parseFileRows, parsePastedData } from '@/lib/scores/mockImportParse';
import {
  buildMockSchoolLines,
  buildTellSections,
  stripTargetSchoolFactLines,
} from '@/app/interview/interview.shared';
import type { MockSchoolRecord } from '@/lib/api/mockTargetSchools';
import type { TargetSchoolRow } from '@/lib/api/targetSchools';
import type { AssessmentWithScores, Student } from '@/types/database';

/**
 * 教室長から受け取った実際の貼り付け（2026-09、Vもぎ・8名）。
 * ★空いた志望校の枠は半角スペース1つ。1〜3枠が公立、4〜5枠が私立。
 */
const NAME_ROWS = [
  '2404\t女\t川原　彩葉',
  '2436\t女\t藤田　愛菜',
  '2456\t男\t溝口　敦也',
  '2521\t男\t酒井　礼央',
  '2534\t女\t柏倉　愛梨',
  '2538\t女\t小川　華佳',
  '2606\t女\t鈴木　さくら',
  '2607\t女\t永井　友音',
];
const SCORE_ROWS = [
  '42\t36\t44\t46\t49\t49\t56\t53\t64\t51\t135\t44\t255\t47\t三田－普通\t**\t狛江－普通\t**\t神代－普通\t20\t駒沢学園女子－特進\t10\t \t\t \t',
  '73\t54\t54\t52\t77\t62\t65\t57\t48\t42\t204\t57\t317\t54\t狛江－普通\t60\t \t\t \t\t専修大附属\t70\t関東国際－韓国語\t95\t \t',
  '45\t38\t32\t40\t32\t42\t27\t38\t44\t40\t109\t38\t180\t38\t府中東－普通\t20\t若葉総合\t60\t永山－普通\t90\t昭和第一学園－総合進学／探究\t30\t \t\t \t',
];

function student(id: string, last: string, first: string): Student {
  return {
    id,
    last_name: last,
    first_name: first,
    last_name_kana: '',
    first_name_kana: '',
    school_id: 'school-1',
  } as unknown as Student;
}

describe('合格可能性の読み取り', () => {
  it('数字はそのまま、** は判定なし（0 にしない）', () => {
    expect(parsePossibility('60')).toEqual({ possibility: 60, unjudged: false });
    expect(parsePossibility('**')).toEqual({ possibility: null, unjudged: true });
    expect(parsePossibility('＊＊')).toEqual({ possibility: null, unjudged: true });
    expect(parsePossibility('９５')).toEqual({ possibility: 95, unjudged: false });
  });

  it('空欄は判定なしではなく「無い」', () => {
    expect(parsePossibility('')).toEqual({ possibility: null, unjudged: false });
    expect(parsePossibility(' ')).toEqual({ possibility: null, unjudged: false });
    expect(parsePossibility(undefined)).toEqual({ possibility: null, unjudged: false });
  });

  it('表示は「60%」／「判定なし」', () => {
    expect(formatPossibility({ possibility: 60, unjudged: false })).toBe('60%');
    expect(formatPossibility({ possibility: null, unjudged: true })).toBe('判定なし');
    expect(formatPossibility({ possibility: null, unjudged: false })).toBe('');
  });
});

describe('志望校の対を読む', () => {
  it('★空いた枠を詰めない（枠の位置で公立・私立が決まる）', () => {
    const cells = SCORE_ROWS[1].split('\t');
    const schools = readMockSchoolPairs(cells, 14);
    expect(schools.map((s) => [s.slot, s.isPublic, s.nameRaw, s.possibility])).toEqual([
      [1, true, '狛江－普通', 60],
      [4, false, '専修大附属', 70],
      [5, false, '関東国際－韓国語', 95],
    ]);
  });
});

describe('貼り付けの読み取り（実データ）', () => {
  const students = [
    student('s-kawahara', '川原', '彩葉'),
    student('s-fujita', '藤田', '愛菜'),
    student('s-mizoguchi', '溝口', '敦也'),
  ];
  const rows = parsePastedData([...NAME_ROWS, ...SCORE_ROWS].join('\n'), students);

  it('氏名行と得点行を同じ順で対にする（得点行が3行なので3名）', () => {
    expect(rows.map((r) => r.originalName)).toEqual(['川原　彩葉', '藤田　愛菜', '溝口　敦也']);
    expect(rows[0].matchedStudent?.id).toBe('s-kawahara');
  });

  it('偏差値（SS）を取り、得点は取らない', () => {
    expect(rows[0].scores).toEqual({
      japanese: 36,
      math: 46,
      english: 49,
      social: 53,
      science: 51,
      hensa_3: 44,
      hensa_5: 47,
    });
  });

  it('★** は判定なしとして残り、合格可能性の数字にならない', () => {
    const s = rows[0].schools;
    expect(s[0]).toMatchObject({
      slot: 1,
      nameRaw: '三田－普通',
      possibility: null,
      unjudged: true,
    });
    expect(s[2]).toMatchObject({
      slot: 3,
      nameRaw: '神代－普通',
      possibility: 20,
      unjudged: false,
    });
    expect(s[3]).toMatchObject({ slot: 4, isPublic: false, nameRaw: '駒沢学園女子－特進' });
    expect(s).toHaveLength(4);
  });

  it('学科の無い書き方（若葉総合）も読む', () => {
    expect(rows[2].schools.map((s) => s.nameRaw)).toEqual([
      '府中東－普通',
      '若葉総合',
      '永山－普通',
      '昭和第一学園－総合進学／探究',
    ]);
    expect(rows[2].schools[1]).toMatchObject({ slot: 2, possibility: 60 });
  });
});

describe('ファイルの読み取り（進研テストの列）', () => {
  it('26列目から志望校と合格可能性の対を読む', () => {
    const header = Array.from({ length: 36 }, (_, i) => `h${i}`);
    const row: (string | number | undefined)[] = Array.from({ length: 36 }, () => '');
    row[5] = '2404';
    row[7] = '川原　彩葉';
    row[13] = 50;
    row[26] = '狛江－普通';
    row[27] = 60;
    row[28] = '三田－普通';
    row[29] = '**';
    row[32] = '専修大附属';
    row[33] = 70;
    const [r] = parseFileRows([header, row], [student('s-1', '川原', '彩葉')]);
    expect(r.scores.japanese).toBe(50);
    expect(r.schools.map((s) => [s.slot, s.possibility, s.unjudged])).toEqual([
      [1, 60, false],
      [2, null, true],
      [4, 70, false],
    ]);
  });
});

describe('学校名の分解', () => {
  it('全角ダッシュで学校と学科に分け、普通は空にする', () => {
    expect(splitMockSchoolName('狛江－普通')).toEqual({ school: '狛江', dept: '' });
    expect(splitMockSchoolName('小平－外国語科')).toEqual({ school: '小平', dept: '外国語' });
    expect(splitMockSchoolName('若葉総合')).toEqual({ school: '若葉総合', dept: '' });
  });

  it('冠と「高校」を外す。市立は外さない（神奈川のマスタは市立を名前に含む）', () => {
    expect(splitMockSchoolName('都立三田高校－普通')).toEqual({ school: '三田', dept: '' });
    expect(splitMockSchoolName('神奈川県立希望ケ丘高等学校')).toEqual({
      school: '希望ヶ丘',
      dept: '',
    });
    expect(splitMockSchoolName('市立橘－普通').school).toBe('市立橘');
  });

  it('面談で読む短い名前', () => {
    expect(mockSchoolShortName('狛江－普通')).toBe('狛江');
    expect(mockSchoolShortName('駒沢学園女子－特進')).toBe('駒沢学園女子（特進）');
  });
});

describe('高校マスタへの当て（matchMockSchoolName）', () => {
  const master: HighSchoolKeyRow[] = [
    { id: 'hs-komae', prefecture: '東京都', school_name: '狛江', course: '' },
    { id: 'hs-kodaira', prefecture: '東京都', school_name: '小平', course: '' },
    { id: 'hs-kodaira-gai', prefecture: '東京都', school_name: '小平', course: '外国語' },
    { id: 'hs-wakaba', prefecture: '東京都', school_name: '若葉総合', course: '' },
    { id: 'hs-kokusai', prefecture: '東京都', school_name: '国際', course: '国際' },
    { id: 'hs-tama-t', prefecture: '東京都', school_name: '多摩', course: '' },
    { id: 'hs-tama-k', prefecture: '神奈川県', school_name: '多摩', course: '' },
  ];

  it('学校名と学科の組で当てる（普通＝普通科の本体）', () => {
    expect(matchMockSchoolName('狛江－普通', master)).toEqual({
      schoolName: '狛江',
      course: '',
      highSchoolId: 'hs-komae',
    });
    expect(matchMockSchoolName('小平－外国語', master).highSchoolId).toBe('hs-kodaira-gai');
  });

  it('★学科が違えば当てない（別の学科のめやすを使わない）', () => {
    expect(matchMockSchoolName('狛江－理数', master).highSchoolId).toBeNull();
  });

  it('学科の無い書き方: 本体があれば本体、1行しか無い学校はそれ', () => {
    expect(matchMockSchoolName('若葉総合', master).highSchoolId).toBe('hs-wakaba');
    expect(matchMockSchoolName('国際', master).highSchoolId).toBe('hs-kokusai');
  });

  it('同名の学校は教室の都県を先に選ぶ', () => {
    expect(matchMockSchoolName('多摩－普通', master, '東京都').highSchoolId).toBe('hs-tama-t');
    expect(matchMockSchoolName('多摩－普通', master, '神奈川県').highSchoolId).toBe('hs-tama-k');
  });

  it('私立などマスタに無い学校は null（名前は残す）', () => {
    expect(matchMockSchoolName('専修大附属', master)).toEqual({
      schoolName: '専修大附属',
      course: '',
      highSchoolId: null,
    });
  });
});

describe('④ 直近の模試の行（buildMockSchoolLines）', () => {
  const assessments = [
    {
      id: 'a-oct',
      category: 'mock',
      name_code: 'venue',
      title: '会場模試',
      exam_month: '2026-10-01',
      exam_date: null,
      scores: [],
    },
    {
      id: 'a-reg',
      category: 'regular_test',
      name_code: 'term2_mid',
      exam_month: null,
      exam_date: null,
      scores: [],
    },
    {
      id: 'a-sep',
      category: 'mock',
      name_code: 'venue',
      title: '会場模試',
      exam_month: '2026-09-01',
      exam_date: null,
      scores: [],
    },
  ] as unknown as AssessmentWithScores[];

  function m(
    assessmentId: string,
    slot: number,
    nameRaw: string,
    possibility: number | null,
    extra: Partial<MockSchoolRecord> = {}
  ): MockSchoolRecord {
    return {
      assessmentId,
      slot,
      isPublic: slot <= 3,
      nameRaw,
      highSchoolId: null,
      possibility,
      unjudged: false,
      ...extra,
    };
  }

  const mocks: MockSchoolRecord[] = [
    m('a-oct', 1, '狛江－普通', 60, { highSchoolId: 'hs-komae' }),
    m('a-oct', 2, '神代－普通', 20),
    m('a-oct', 3, '三田－普通', null, { unjudged: true }),
    m('a-oct', 4, '専修大附属', 70),
    m('a-sep', 1, '狛江－普通', 50, { highSchoolId: 'hs-komae' }),
  ];

  function target(schoolName: string, highSchoolId: string | null): TargetSchoolRow {
    return {
      id: `t-${schoolName}`,
      rank: 1,
      schoolName,
      highSchoolId,
      reason: null,
      isHeigan: false,
      updatedAt: '',
      master: null,
    };
  }

  it('直近の模試・前回との比較・私立を1行に組む', () => {
    const lines = buildMockSchoolLines(mocks, assessments, []);
    expect(lines.tell[0]).toBe(
      '直近の模試（会場模試 10月） ―― 狛江 60%（前回 50%）・神代 20%・三田 判定なし／私立 専修大附属 70%'
    );
    expect(lines.aiLine).toBe(lines.tell[0]);
  });

  it('★志望校が未登録の生徒には「登録に無い」を出さない（④の「聞いて入れる」と重ねない）', () => {
    const lines = buildMockSchoolLines(mocks, assessments, []);
    expect(lines.tell).toHaveLength(1);
    expect(lines.ask).toEqual([]);
  });

  it('登録に無い公立校を指摘し、左で聞く', () => {
    const lines = buildMockSchoolLines(mocks, assessments, [
      target('狛江', 'hs-komae'),
      target('神代', null),
    ]);
    expect(lines.tell[1]).toBe('★模試では 三田 も書いている（登録に無い）');
    expect(lines.ask).toEqual(['模試で書いた 三田 は志望校に入れるか聞く']);
  });

  it('模試の志望校が無ければ何も出さない', () => {
    expect(buildMockSchoolLines([], assessments, [])).toEqual({ tell: [], ask: [], aiLine: null });
  });

  it('★AIの score には混ぜるが、画面の事実の行からは外す（④で別に出すため）', () => {
    const sections = buildTellSections({
      assessments,
      interviews: [],
      textbookData: [],
      disciplineSessions: [],
      koushuEnrollments: [],
      mockSchools: mocks,
    });
    const score = sections.find((s) => s.key === 'score');
    expect(score?.current.some((l) => l.startsWith('直近の模試（'))).toBe(true);
    expect(stripTargetSchoolFactLines(score?.current ?? [])).toEqual([]);
  });
});
