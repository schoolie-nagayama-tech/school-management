/**
 * ④「志望校と提案」の私立（併願優遇）のテスト。
 *
 * ★守りたいのは次の点:
 *  - 並べるのは併願の区分の内申基準が「いまの内申±1」の学校だけ（あと1／ちょうど／1余裕）
 *  - 選択肢（①5科21または②9科38）は本人に一番有利なものを採る
 *  - 前提で落ちる（9科に2は不可）・平均の基準だけ・推薦しか無い・20km超・登録済みは出さない
 *  - 並びは あと1 → ちょうど → 1余裕、同じ差の中は偏差値の高い順
 *  - 行に出す条件の札（第2志望のみ・9科に2は不可・英検）と、比べる材料（区分・基準・本人）
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import {
  buildPrivateProposals,
  privateHensachiText,
  type PrivateProposalRow,
} from '@/lib/interview/privateProposals';
import {
  admissionMargin,
  evaluateRule,
  ruleConditionChips,
  ruleCriterionText,
  type AdmissionRule,
  type AdmissionRuleBody,
  type StudentReportCards,
} from '@/lib/interview/privateAdmission';
import type { NearbyPrivateSchool } from '@/lib/api/targetProposals';

const ORIGIN = { name: '京王永山', lat: 35.633133, lon: 139.447712 };

/** 5科22・9科38 になる評定（国数英理社＝5,5,4,4,4／実技＝4,4,4,4） */
const CARDS: StudentReportCards = {
  grade3: { 国: 5, 数: 5, 英: 4, 理: 4, 社: 4, 音: 4, 美: 4, 保体: 4, 技家: 4 },
  grade2: null,
  provisional: null,
};

function rule(over: Partial<AdmissionRule> & { body: Partial<AdmissionRuleBody> }): AdmissionRule {
  return {
    id: 'r',
    kind: '併願',
    examLabel: '併願（公私）',
    publicOnly: false,
    applicantScope: null,
    gender: null,
    strength: null,
    checks: [],
    rawText: '',
    sourceLabel: '',
    verifiedAt: '2026-09-25',
    sortOrder: 0,
    ...over,
    body: { any: [], gates: [], bonus: null, no_criterion: null, ...over.body },
  };
}

function school(
  id: string,
  rules: AdmissionRule[],
  over: { hensachi?: number | null; lat?: number; course?: string } = {}
): NearbyPrivateSchool {
  return {
    school: {
      id,
      prefecture: '東京都',
      establishment: '私立',
      schoolName: id,
      course: over.course ?? '',
      category: '',
      lat: over.lat ?? ORIGIN.lat + 0.01,
      lon: ORIGIN.lon,
      accessLines: [],
      naishin: null,
      naishinMax: null,
      hensachi: over.hensachi === undefined ? 55 : over.hensachi,
      sourceLabel: '',
      verifiedAt: null,
    },
    hensachiByGender: {},
    genderType: '共学',
    rules,
  };
}

const sum5 = (min: number) => ({ t: 'sum' as const, s: '5科' as const, min });
const sum9 = (min: number) => ({ t: 'sum' as const, s: '9科' as const, min });

function build(candidates: NearbyPrivateSchool[], registered: string[] = []): PrivateProposalRow[] {
  return buildPrivateProposals({
    candidates,
    cards: CARDS,
    region: 'tokyo',
    origin: ORIGIN,
    registeredIds: new Set(registered),
  });
}

describe('admissionMargin', () => {
  it('選択肢のうち本人に一番有利な余りを採る', () => {
    // 5科23（あと1）または 9科38（ちょうど）→ ちょうど
    const j = evaluateRule(rule({ body: { any: [[sum5(23)], [sum9(38)]] } }), CARDS);
    expect(admissionMargin(j)).toBe(0);
  });
  it('「かつ」は一番きつい合計で見る', () => {
    const j = evaluateRule(rule({ body: { any: [[sum5(21), sum9(39)]] } }), CARDS);
    expect(admissionMargin(j)).toBe(-1);
  });
  it('前提で落ちれば null', () => {
    const j = evaluateRule(
      rule({
        body: { any: [[sum5(20)]], gates: [{ t: 'none_le', s: '9科', grade: 4 }] },
      }),
      CARDS
    );
    expect(admissionMargin(j)).toBeNull();
  });
});

describe('buildPrivateProposals', () => {
  it('±1の学校だけを あと1 → ちょうど → 1余裕、同じ差は偏差値の高い順に並べる', () => {
    const rows = build([
      school('余裕', [rule({ body: { any: [[sum5(21)]] } })], { hensachi: 58 }),
      school('ちょうどA', [rule({ body: { any: [[sum5(22)]] } })], { hensachi: 57 }),
      school('ちょうどB', [rule({ body: { any: [[sum5(22)]] } })], { hensachi: 60 }),
      school('あと1', [rule({ body: { any: [[sum5(23)]] } })], { hensachi: 60 }),
      school('あと2', [rule({ body: { any: [[sum5(24)]] } })]),
      school('2余裕', [rule({ body: { any: [[sum5(20)]] } })]),
    ]);
    expect(rows.map((r) => [r.school.id, r.band])).toEqual([
      ['あと1', 'near'],
      ['ちょうどB', 'even'],
      ['ちょうどA', 'even'],
      ['余裕', 'over'],
    ]);
    expect(rows.map((r) => r.judgmentText)).toEqual([
      '5科 あと1',
      '5科 ちょうど',
      '5科 ちょうど',
      '5科 1余裕',
    ]);
  });

  it('推薦しか無い・平均の基準だけ・20km超・登録済みは出さない', () => {
    const rows = build(
      [
        school('推薦だけ', [
          rule({ kind: '推薦', examLabel: '推薦', body: { any: [[sum5(22)]] } }),
        ]),
        school('平均', [rule({ body: { any: [[{ t: 'avg', s: '9科', min: 4.2 }]] } })]),
        school('遠い', [rule({ body: { any: [[sum5(22)]] } })], { lat: ORIGIN.lat + 0.3 }),
        school('登録済み', [rule({ body: { any: [[sum5(22)]] } })]),
      ],
      ['登録済み']
    );
    expect(rows).toEqual([]);
  });

  it('都神外生向けの区分は使わない（教室の生徒が受けられない）', () => {
    const rows = build([
      school('外生', [
        rule({
          applicantScope: '都神外生',
          examLabel: '併願推薦（都神外生）',
          body: { any: [[sum5(22)]] },
        }),
      ]),
    ]);
    expect(rows).toEqual([]);
  });

  it('通知表が無ければ何も出さない', () => {
    const rows = buildPrivateProposals({
      candidates: [school('A', [rule({ body: { any: [[sum5(22)]] } })])],
      cards: { grade3: null, grade2: null, provisional: null },
      region: 'tokyo',
      origin: ORIGIN,
      registeredIds: new Set(),
    });
    expect(rows).toEqual([]);
  });

  it('比べる材料に区分・基準・本人の合計を入れる', () => {
    const [r] = build([
      school('明星', [
        rule({
          examLabel: '併願(公私・第2志望)',
          body: {
            any: [[sum5(22)], [sum9(37)]],
            gates: [{ t: 'none_le', s: '9科', grade: 1 }],
          },
        }),
      ]),
    ]);
    expect(r.band).toBe('over');
    expect(r.chips).toEqual(['第2志望のみ', '9科に1は不可']);
    expect(r.compare.criterion).toBe('5科22または9科37');
    expect(r.compare.own).toBe('5科22・9科38');
    expect(r.compare.heading).toBe('併願(公私・第2志望)');
  });
});

describe('札と偏差値の見せ方', () => {
  it('検定は札に出す', () => {
    expect(
      ruleConditionChips(rule({ body: { any: [[{ t: 'cert', name: '英検2級' }, sum5(20)]] } }))
    ).toEqual(['英検2級']);
  });
  it('基準が無い区分は理由をそのまま', () => {
    expect(ruleCriterionText(rule({ body: { no_criterion: '内申基準なし（学力重視）' } }))).toBe(
      '内申基準なし（学力重視）'
    );
  });
  it('男女で違う偏差値は両方', () => {
    expect(privateHensachiText(null, { 男子: 57, 女子: 56 })).toBe('男57／女56');
    expect(privateHensachiText(60, {})).toBe('60');
    expect(privateHensachiText(null, {})).toBe('—');
  });
});

describe('沿線と基準の見せ方（本番データで見つけた崩れ）', () => {
  it('会社名と「◯号線」を外し、「本線」だけは元のまま残す', async () => {
    const { shortLineName, commuteText } = await import('@/lib/interview/targetProposals');
    expect(shortLineName('東日本旅客鉄道 中央線')).toBe('中央線');
    expect(shortLineName('東京地下鉄 4号線丸ノ内線')).toBe('丸ノ内線');
    expect(shortLineName('京浜急行電鉄 本線')).toBe('京浜急行電鉄 本線');
    expect(shortLineName('京王相模原線')).toBe('京王相模原線');
    // 短くした結果が同じになった沿線は重ねない
    expect(commuteText(12, ['東京地下鉄 4号線丸ノ内線', '東京地下鉄 丸ノ内線', 'x 井の頭線'])).toBe(
      '電車 直線12.0km・丸ノ内線・井の頭線'
    );
  });
  it('検定だけが違う選択肢は、基準の文を重ねない', () => {
    expect(
      ruleCriterionText(
        rule({
          body: {
            any: [
              [sum5(22), { t: 'cert', name: '英検準2級' }],
              [sum5(22), { t: 'each', s: ['英'], min: 4 }],
              [sum9(38)],
            ],
          },
        })
      )
    ).toBe('5科22または9科38');
  });
  it('男女で同じ偏差値は1つにまとめる', () => {
    expect(privateHensachiText(null, { 男子: 64, 女子: 64 })).toBe('64');
  });
});
