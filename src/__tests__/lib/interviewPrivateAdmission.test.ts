import { describe, it, expect } from 'vitest';
import {
  buildTargetSchoolGapLines,
  buildTargetSchoolTalkLines,
} from '@/app/interview/interview.shared';
import type { AssessmentWithScores } from '@/types/database';
import type { TargetSchoolRow, TargetSchoolMaster } from '@/lib/api/targetSchools';
import { buildStudentReportCards, type AdmissionRule } from '@/lib/interview/privateAdmission';

/**
 * 面談④で、私立の志望校に推薦・併願優遇の判定を出すこと（interview.shared.ts）。
 * 生徒は 国4 数4 英4 理4 社3 ／ 音4 美3 保体5 技家2（3科12・5科19・9科33、技家に2）。
 */
const reportCard = {
  category: 'report_card',
  grade: 9,
  name_code: 'term2',
  scores: [
    { subject: 'japanese', value: 4 },
    { subject: 'math', value: 4 },
    { subject: 'english', value: 4 },
    { subject: 'science', value: 4 },
    { subject: 'social', value: 3 },
    { subject: 'music', value: 4 },
    { subject: 'art', value: 3 },
    { subject: 'pe', value: 5 },
    { subject: 'tech_home', value: 2 },
  ],
} as unknown as AssessmentWithScores;

function rule(overrides: Partial<AdmissionRule>): AdmissionRule {
  return {
    id: 'r',
    kind: '併願',
    examLabel: '併願（公私）',
    publicOnly: false,
    applicantScope: null,
    gender: null,
    strength: null,
    body: { any: [[{ t: 'sum', s: '5科', min: 18 }]], gates: [], bonus: null, no_criterion: null },
    checks: ['3年次の欠席10日以内'],
    rawText: '',
    sourceLabel: '私立 推薦・一般入試の基準表',
    verifiedAt: null,
    sortOrder: 0,
    ...overrides,
  };
}

function privateSchool(
  rules: AdmissionRule[],
  master: Partial<TargetSchoolMaster> = {}
): TargetSchoolRow {
  return {
    id: 't1',
    rank: 2,
    schoolName: '八王子実践',
    highSchoolId: 'h1',
    reason: null,
    isHeigan: false,
    updatedAt: '2026-09-25T00:00:00Z',
    master: {
      prefecture: '東京都',
      schoolName: '八王子実践',
      course: '選抜',
      category: '普通科',
      establishment: '私立',
      naishin: null,
      naishinMax: null,
      hensachi: 51,
      hensachiByGender: {},
      admissionRules: rules,
      sourceLabel: 'Vもぎ 私立',
      verifiedAt: null,
      accessLines: [],
      ...master,
    },
  };
}

describe('buildTargetSchoolGapLines（私立）', () => {
  it('代表の区分の判定を行に足し、原本と未照合であることを添える', () => {
    const { tell } = buildTargetSchoolGapLines([privateSchool([rule({})])], [reportCard], 'tokyo');
    expect(tell[0]).toContain('併願（公私） 届いている・5科19（基準18）を満たす');
    expect(tell[0]).toContain('基準は原本と未照合');
  });

  it('教室の生徒が受けられない区分（都神外生）は代表に選ばない', () => {
    const rules = [
      rule({ id: 'a', examLabel: 'B推薦（都神外生）', applicantScope: '都神外生', sortOrder: 0 }),
      rule({
        id: 'b',
        examLabel: '推薦',
        kind: '推薦',
        body: {
          any: [[{ t: 'sum', s: '5科', min: 17 }]],
          gates: [],
          bonus: null,
          no_criterion: null,
        },
        sortOrder: 1,
      }),
    ];
    const { tell } = buildTargetSchoolGapLines([privateSchool(rules)], [reportCard], 'tokyo');
    expect(tell[0]).toContain('推薦 届いている');
    expect(tell[0]).not.toContain('都神外生');
  });

  it('男女で偏差値が違うときは両方並べ、差は出さない', () => {
    const school = privateSchool([rule({})], {
      hensachi: null,
      hensachiByGender: { 男子: 56, 女子: 58 },
    });
    const { tell } = buildTargetSchoolGapLines([school], [reportCard], 'tokyo');
    expect(tell[0]).toContain('必要偏差値 男子56・女子58');
  });

  it('公立（基準なし）の行は変わらない', () => {
    const school = privateSchool([], { establishment: '公立', naishin: 45, naishinMax: 65 });
    const { tell } = buildTargetSchoolGapLines([school], [reportCard], 'tokyo');
    expect(tell[0]).not.toContain('併願');
  });
});

describe('buildTargetSchoolTalkLines（私立）', () => {
  const cards = buildStudentReportCards([reportCard]);

  it('届いていれば言い、確認事項を聞くことに回す', () => {
    const lines = buildTargetSchoolTalkLines(
      [privateSchool([rule({})])],
      null,
      null,
      'tokyo',
      null,
      cards
    );
    expect(lines[0]).toMatchObject({ kind: 'say' });
    expect(lines[0].text).toContain('八王子実践：併願（公私）の内申の基準は届いている');
    expect(lines).toContainEqual({
      kind: 'ask',
      text: '八王子実践：3年次の欠席10日以内を確かめる',
    });
  });

  it('9科に2は不可 で落ちるときは理由と次の手を言う', () => {
    const ng = rule({
      body: {
        any: [[{ t: 'sum', s: '3科', min: 11 }]],
        gates: [{ t: 'none_le', s: '9科', grade: 2 }],
        bonus: null,
        no_criterion: null,
      },
    });
    const lines = buildTargetSchoolTalkLines(
      [privateSchool([ng])],
      null,
      null,
      'tokyo',
      null,
      cards
    );
    expect(lines[0].text).toContain('9科に2は不可（技家が2）');
    expect(lines[0].text).toContain('一般入試か別のコースを考える');
  });

  it('私立の判定を出したときは「比べる材料が無い」を言わない', () => {
    const school = privateSchool([rule({})], { hensachi: null });
    const lines = buildTargetSchoolTalkLines([school], null, null, 'tokyo', null, cards);
    expect(lines.some((l) => l.text.includes('比べる材料が無い'))).toBe(false);
  });

  it('通知表を渡さない呼び出し元（従来）では私立の行を出さない', () => {
    const lines = buildTargetSchoolTalkLines([privateSchool([rule({})])], null, 55, 'tokyo');
    expect(lines.some((l) => l.text.includes('併願（公私）'))).toBe(false);
  });
});
