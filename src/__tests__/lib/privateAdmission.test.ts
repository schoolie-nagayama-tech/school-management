import { describe, it, expect } from 'vitest';
import {
  buildStudentReportCards,
  evaluateClause,
  evaluateRule,
  pickPrimaryRule,
  scopeApplies,
  type AdmissionRule,
  type AdmissionRuleBody,
  type StudentReportCards,
} from '@/lib/interview/privateAdmission';

/**
 * 条件の数値は冊子（推薦・一般入試の基準表）の実際の学校から取った。
 * 生徒はモック（docs/mockups/private-school-judgment.html）と同じ:
 *   国4 数4 英4 理4 社3 ／ 音4 美3 保体5 技家2 → 3科12・5科19・9科33、技家に2がある。
 */
const cards: StudentReportCards = {
  grade3: { 国: 4, 数: 4, 英: 4, 理: 4, 社: 3, 音: 4, 美: 3, 保体: 5, 技家: 2 },
  grade2: { 国: 4, 数: 4, 英: 4, 理: 3, 社: 3, 音: 4, 美: 3, 保体: 4, 技家: 3 },
  provisional: null,
};

function rule(body: Partial<AdmissionRuleBody>, extra: Partial<AdmissionRule> = {}): AdmissionRule {
  return {
    id: 'r1',
    kind: '併願',
    examLabel: '併願（公私）',
    publicOnly: false,
    applicantScope: null,
    gender: null,
    strength: null,
    body: { any: [], gates: [], bonus: null, no_criterion: null, ...body },
    checks: [],
    rawText: '',
    sourceLabel: '',
    verifiedAt: null,
    sortOrder: 0,
    ...extra,
  };
}

describe('evaluateClause', () => {
  it('合計は本人の値と不足を返す', () => {
    const r = evaluateClause({ t: 'sum', s: '5科', min: 21 }, cards);
    expect(r).toMatchObject({ state: 'short', have: 19, gap: 2 });
  });

  it('9科に2は不可 は、2がある教科を理由に出す', () => {
    const r = evaluateClause({ t: 'none_le', s: '9科', grade: 2 }, cards);
    expect(r.state).toBe('fail');
    expect(r.reason).toBe('技家が2');
  });

  it('神奈川方式（2年次＋3年次×2）で合計する', () => {
    // 2年次9科=32、3年次9科=33 → 32 + 66 = 98
    const r = evaluateClause(
      {
        t: 'sum',
        s: '9科',
        min: 100,
        of: 135,
        years: [
          { grade: 2, w: 1 },
          { grade: 3, w: 2 },
        ],
      },
      cards
    );
    expect(r).toMatchObject({ state: 'short', have: 98, gap: 2 });
  });

  it('「5科のうち任意の3科」は本人に最も有利な3教科で数える', () => {
    const r = evaluateClause({ t: 'sum', s: { best: 3, of: '5科' }, min: 12 }, cards);
    expect(r).toMatchObject({ state: 'met', have: 12 });
  });

  it('平均は小数1桁で比べる', () => {
    // 5科平均 = 19/5 = 3.8
    const r = evaluateClause({ t: 'avg', s: '5科', min: 4.2 }, cards);
    expect(r).toMatchObject({ state: 'short', have: 3.8, gap: 0.4 });
  });

  it('評定が1つでも欠けていれば推測せず nodata', () => {
    const missing: StudentReportCards = {
      ...cards,
      grade3: { ...cards.grade3, 技家: null },
    };
    expect(evaluateClause({ t: 'sum', s: '9科', min: 30 }, missing).state).toBe('nodata');
  });

  it('検定はNESTに無いので cert のまま（満たしたとみなさない）', () => {
    expect(evaluateClause({ t: 'cert', name: '英検準2級' }, cards).state).toBe('cert');
  });
});

describe('evaluateRule', () => {
  it('東京立正 アドバンスト 併願: ①3科11 ②5科18 ③9科33 のいずれか → 届いている', () => {
    const j = evaluateRule(
      rule({
        any: [
          [{ t: 'sum', s: '3科', min: 11 }],
          [{ t: 'sum', s: '5科', min: 18 }],
          [{ t: 'sum', s: '9科', min: 33 }],
        ],
        gates: [{ t: 'none_le', s: '9科', grade: 1 }],
      }),
      cards
    );
    expect(j.status).toBe('ok');
    expect(j.summary).toBe('3科12（基準11）を満たす');
  });

  it('杉並学院 総進: 数値は届いていても「9科に2は不可」で不可', () => {
    const j = evaluateRule(
      rule({
        any: [
          [{ t: 'sum', s: '3科', min: 11 }],
          [{ t: 'sum', s: '5科', min: 18 }],
          [{ t: 'sum', s: '9科', min: 34 }],
        ],
        gates: [{ t: 'none_le', s: '9科', grade: 2 }],
      }),
      cards
    );
    expect(j.status).toBe('ng');
    expect(j.summary).toBe('9科に2は不可（技家が2）');
  });

  it('工学院大附属 先進文理 併願: 3科14または5科21、検定で最大+3 → 加点次第', () => {
    const j = evaluateRule(
      rule({
        any: [[{ t: 'sum', s: '3科', min: 14 }], [{ t: 'sum', s: '5科', min: 21 }]],
        gates: [{ t: 'none_le', s: '9科', grade: 1 }],
        bonus: {
          max: 3,
          items: [
            {
              label: '英・漢・数検いずれか3級',
              points: 1,
              when: { t: 'cert', name: '英・漢・数検いずれか3級' },
            },
            { label: '英検準2級', points: 2, when: { t: 'cert', name: '英検準2級' } },
          ],
        },
      }),
      cards
    );
    expect(j.status).toBe('bonus');
    expect(j.summary).toContain('3科であと2');
  });

  it('加点の上限を超える不足は「届かない」', () => {
    // 東洋 特選 併願: 5科24（本人19・あと5）、加点は最大+1
    const j = evaluateRule(
      rule({
        any: [[{ t: 'sum', s: '5科', min: 24 }]],
        bonus: {
          max: 1,
          items: [{ label: '生徒会役員', points: 1, when: { t: 'manual', text: '生徒会役員' } }],
        },
      }),
      cards
    );
    expect(j.status).toBe('short');
    expect(j.summary).toBe('5科であと5');
  });

  it('本人の評定で分かる加点（9科に5がある）は自動で足す', () => {
    // 5科20が基準、本人19。「9科に5がある」で+1（本人は保体5）
    const j = evaluateRule(
      rule({
        any: [[{ t: 'sum', s: '5科', min: 20 }]],
        bonus: {
          max: 2,
          items: [{ label: '9科に5がある', points: 1, when: { t: 'any_ge', s: '9科', grade: 5 } }],
        },
      }),
      cards
    );
    expect(j.status).toBe('ok_with_bonus');
  });

  it('合計ごとの上限（5科に+1まで）を守る', () => {
    // 5科21が基準（あと2）。加点は全体+3だが 5科には+1まで
    const j = evaluateRule(
      rule({
        any: [[{ t: 'sum', s: '5科', min: 21 }]],
        bonus: {
          max: 3,
          max_by: { '5科': 1, '9科': 2 },
          items: [{ label: '英検準2級', points: 2, when: { t: 'cert', name: '英検準2級' } }],
        },
      }),
      cards
    );
    expect(j.status).toBe('short');
  });

  it('数値は届いていて検定が要件のときは「条件つき」', () => {
    // 工学院大附属 インター 推薦: 3科11かつ英検2級
    const j = evaluateRule(
      rule({
        any: [
          [
            { t: 'sum', s: '3科', min: 11 },
            { t: 'cert', name: '英検2級' },
          ],
        ],
      }),
      cards
    );
    expect(j.status).toBe('conditional');
    expect(j.checks).toContain('英検2級');
  });

  it('内申基準が無い区分は「内申では決まらない」', () => {
    const j = evaluateRule(rule({ no_criterion: '基準なし（入試点重視）' }), cards);
    expect(j.status).toBe('na');
    expect(j.summary).toBe('基準なし（入試点重視）');
  });

  it('通知表が無ければ nodata', () => {
    const j = evaluateRule(rule({ any: [[{ t: 'sum', s: '5科', min: 18 }]] }), {
      grade3: null,
      grade2: null,
      provisional: null,
    });
    expect(j.status).toBe('nodata');
  });
});

describe('scopeApplies / pickPrimaryRule', () => {
  it('都神外生向けの区分は東京・神奈川の教室では使わない', () => {
    expect(scopeApplies('都神外生', 'tokyo')).toBe(false);
    expect(scopeApplies('都神外生', 'kanagawa')).toBe(false);
    expect(scopeApplies('都外生', 'kanagawa')).toBe(true);
    expect(scopeApplies('東京・神奈川県生', 'tokyo')).toBe(true);
    expect(scopeApplies('埼玉・千葉県生', 'tokyo')).toBe(false);
    expect(scopeApplies(null, null)).toBe(true);
  });

  it('代表は併願（公私）→併願（公）→推薦→単願の順', () => {
    const rules = [
      rule({}, { id: 'a', kind: '推薦', examLabel: 'A推薦', sortOrder: 0 }),
      rule(
        {},
        { id: 'b', kind: '併願', examLabel: 'B推薦', applicantScope: '都神外生', sortOrder: 1 }
      ),
      rule({}, { id: 'c', kind: '併願', examLabel: '併願（公）', publicOnly: true, sortOrder: 2 }),
      rule({}, { id: 'd', kind: '併願', examLabel: '併願（公私）', sortOrder: 3 }),
    ];
    expect(pickPrimaryRule(rules, 'tokyo')?.id).toBe('d');
    expect(pickPrimaryRule(rules.slice(0, 3), 'tokyo')?.id).toBe('c');
    expect(pickPrimaryRule(rules.slice(0, 2), 'tokyo')?.id).toBe('a');
  });
});

describe('buildStudentReportCards', () => {
  const card = (grade: number, name_code: string, eng: number) => ({
    category: 'report_card',
    grade,
    name_code,
    scores: [{ subject: 'english', value: eng }],
  });

  it('中3は2学期を1学期より優先する', () => {
    const r = buildStudentReportCards([card(9, 'term1', 3), card(9, 'term2', 5)]);
    expect(r.grade3?.英).toBe(5);
    expect(r.provisional).toBeNull();
  });

  it('中3が1学期だけなら仮判定', () => {
    const r = buildStudentReportCards([card(9, 'term1', 3)]);
    expect(r.provisional).toBe('1学期');
  });

  it('中3が無ければ中2の学年末で仮判定', () => {
    const r = buildStudentReportCards([card(8, 'year_end', 4)]);
    expect(r.grade3?.英).toBe(4);
    expect(r.provisional).toBe('2年学年末');
  });
});
