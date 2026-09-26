/**
 * ④「志望校と提案」と「勉強の仕方」のテスト。
 *
 * ★守りたいのは次の点:
 *  - 区分は偏差値の差（本人 − めやす）だけで決まる（挑戦 −5〜−3／順当 ±2／安全 +3〜+6）
 *  - 提案は普通科の本体・直線15km以内・区分ごとに近い順。1区分は登録済みの公立の志望校を含めて3校
 *    （私立の志望校は数えない）。登録済みの志望校は範囲外でも・3校を超えても必ず並ぶ
 *  - 偏差値が無い・起点が無いときは提案を作らない（登録済みだけ）
 *  - 通学は 8km まで自転車の分、遠ければ電車として直線距離と沿線だけ（所要時間は作らない）
 *  - 勉強の仕方は一覧に無い id を捨て、数字入り・長すぎの理由は理由だけ落とす
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import {
  bandOf,
  buildTargetProposals,
  commuteText,
  formatGap,
  type ProposalSchool,
} from '@/lib/interview/targetProposals';
import { parseBriefResult, briefSystemPrompt } from '@/lib/ai/interviewBrief';
import { STUDY_TIPS } from '@/lib/interview/studyTips';

const ORIGIN = { name: '京王永山', lat: 35.633133, lon: 139.447712 };

function school(
  over: Partial<ProposalSchool> & { id: string; hensachi: number | null }
): ProposalSchool {
  return {
    prefecture: '東京都',
    schoolName: over.id,
    course: '',
    category: '普通科',
    // 既定は起点のすぐ近く
    lat: ORIGIN.lat + 0.01,
    lon: ORIGIN.lon,
    accessLines: ['京王相模原線'],
    naishin: null,
    naishinMax: 65,
    sourceLabel: '',
    verifiedAt: null,
    ...over,
  };
}

const own = { tokyo: 53, kanagawa: null };

describe('bandOf', () => {
  it('差（本人 − めやす）で区分を決める', () => {
    expect(bandOf(-5)).toBe('challenge');
    expect(bandOf(-3)).toBe('challenge');
    expect(bandOf(-2)).toBe('fit');
    expect(bandOf(2)).toBe('fit');
    expect(bandOf(3)).toBe('safe');
  });
});

describe('buildTargetProposals', () => {
  it('範囲外の偏差値・コース・遠い学校は提案に出さない', () => {
    const rows = buildTargetProposals({
      schools: [
        school({ id: '挑戦', hensachi: 58 }),
        school({ id: '高すぎ', hensachi: 61 }),
        school({ id: 'コース', hensachi: 54, course: '外国語科' }),
        // 直線で約22km北
        school({ id: '遠い', hensachi: 54, lat: ORIGIN.lat + 0.2 }),
        school({ id: '順当', hensachi: 54 }),
        school({ id: '安全', hensachi: 50 }),
      ],
      own,
      ownHensachi: 54,
      origin: ORIGIN,
      registered: [],
    });
    expect(rows.map((r) => r.school.id)).toEqual(['挑戦', '順当', '安全']);
    expect(rows.map((r) => r.band)).toEqual(['challenge', 'fit', 'safe']);
    expect(rows[0].hensachiDiff).toBe(-4);
  });

  it('区分ごとに近い順で3校まで', () => {
    const schools = [0.05, 0.01, 0.04, 0.02, 0.03].map((d, i) =>
      school({ id: `順当${i}`, hensachi: 54, lat: ORIGIN.lat + d })
    );
    const rows = buildTargetProposals({
      schools,
      own,
      ownHensachi: 54,
      origin: ORIGIN,
      registered: [],
    });
    expect(rows.map((r) => r.school.id)).toEqual(['順当1', '順当3', '順当4']);
  });

  it('登録済みの志望校は範囲外・コース・遠くても必ず並び、区分の中で先頭に来る', () => {
    const rows = buildTargetProposals({
      schools: [
        school({ id: '近い順当', hensachi: 54 }),
        school({ id: '第1志望', hensachi: 65, course: '理数科', lat: ORIGIN.lat + 0.3 }),
        school({ id: '第2志望', hensachi: 55, lat: ORIGIN.lat + 0.05 }),
      ],
      own,
      ownHensachi: 54,
      origin: ORIGIN,
      registered: [
        { highSchoolId: '第1志望', rank: 1 },
        { highSchoolId: '第2志望', rank: 2 },
      ],
    });
    expect(rows.map((r) => [r.school.id, r.band, r.rank])).toEqual([
      ['第1志望', 'challenge', 1],
      ['第2志望', 'fit', 2],
      ['近い順当', 'fit', null],
    ]);
  });

  it('★登録済みの公立の志望校はその区分の3校に数え、候補は残りの枠だけ埋める', () => {
    const near = [0.01, 0.02, 0.03, 0.04].map((d, i) =>
      school({ id: `順当${i}`, hensachi: 54, lat: ORIGIN.lat + d })
    );
    const rows = buildTargetProposals({
      schools: [
        ...near,
        school({ id: '第1志望', hensachi: 55, lat: ORIGIN.lat + 0.05 }),
        school({ id: '第2志望', hensachi: 53, lat: ORIGIN.lat + 0.06 }),
      ],
      own,
      ownHensachi: 54,
      origin: ORIGIN,
      registered: [
        { highSchoolId: '第1志望', rank: 1 },
        { highSchoolId: '第2志望', rank: 2, isHeigan: true },
      ],
    });
    expect(rows.map((r) => r.school.id)).toEqual(['第1志望', '第2志望', '順当0']);
    expect(rows.map((r) => r.heigan)).toEqual([false, true, false]);
  });

  it('★登録済みが3校を超えても削らず、その区分の候補は出さない', () => {
    const rows = buildTargetProposals({
      schools: [
        school({ id: '近い順当', hensachi: 54 }),
        ...[1, 2, 3, 4].map((i) =>
          school({ id: `志望${i}`, hensachi: 54, lat: ORIGIN.lat + 0.02 * i })
        ),
      ],
      own,
      ownHensachi: 54,
      origin: ORIGIN,
      registered: [1, 2, 3, 4].map((i) => ({ highSchoolId: `志望${i}`, rank: i })),
    });
    expect(rows.map((r) => r.school.id)).toEqual(['志望1', '志望2', '志望3', '志望4']);
  });

  it('★登録済みの私立は公立の枠を使わない（私立の提案は別の欄）', () => {
    const near = [0.01, 0.02, 0.03].map((d, i) =>
      school({ id: `順当${i}`, hensachi: 54, lat: ORIGIN.lat + d })
    );
    const rows = buildTargetProposals({
      schools: [...near, school({ id: '私立', hensachi: 54, establishment: '私立' })],
      own,
      ownHensachi: 54,
      origin: ORIGIN,
      registered: [{ highSchoolId: '私立', rank: 2, isHeigan: true }],
    });
    expect(rows.map((r) => r.school.id)).toEqual(['私立', '順当0', '順当1', '順当2']);
  });

  it('偏差値が無ければ提案は作らず、登録済みだけを区分なしで返す', () => {
    const rows = buildTargetProposals({
      schools: [school({ id: '第1志望', hensachi: 55 }), school({ id: 'ほか', hensachi: 54 })],
      own,
      ownHensachi: null,
      origin: ORIGIN,
      registered: [{ highSchoolId: '第1志望', rank: 1 }],
    });
    expect(rows.map((r) => [r.school.id, r.band])).toEqual([['第1志望', null]]);
  });

  it('教室の最寄り駅が無ければ提案は作らない（距離で絞れない）', () => {
    const rows = buildTargetProposals({
      schools: [school({ id: 'ほか', hensachi: 54 })],
      own,
      ownHensachi: 54,
      origin: null,
      registered: [],
    });
    expect(rows).toEqual([]);
  });

  it('内申の差は学校の満点で比べ、65以外の満点とは取らない', () => {
    const rows = buildTargetProposals({
      schools: [
        school({ id: '都立', hensachi: 54, naishin: 49, naishinMax: 65 }),
        school({ id: '3教科', hensachi: 54, naishin: 60, naishinMax: 75, lat: ORIGIN.lat + 0.02 }),
      ],
      own,
      ownHensachi: 54,
      origin: ORIGIN,
      registered: [],
    });
    expect(rows.map((r) => r.naishinDiff)).toEqual([4, null]);
  });
});

describe('commuteText', () => {
  it('8kmまでは自転車の分（切り上げ）と直線距離', () => {
    expect(commuteText(5.2, ['京王線'])).toBe('自転車 約21分（直線5.2km）');
  });
  it('遠ければ電車として直線距離と沿線2本まで。所要時間は出さない', () => {
    expect(commuteText(12.34, ['京王線', '南武線', '小田急線'])).toBe(
      '電車 直線12.3km・京王線・南武線'
    );
    expect(commuteText(12, [])).toBe('電車 直線12.0km');
  });
});

describe('formatGap', () => {
  it('足りない／余裕／同じ', () => {
    expect(formatGap(-4)).toEqual({ text: 'あと4', tone: 'short' });
    expect(formatGap(3)).toEqual({ text: '3余裕', tone: 'over' });
    expect(formatGap(0)).toEqual({ text: '同じ', tone: 'even' });
    expect(formatGap(null)).toBeNull();
  });
});

describe('勉強の仕方（studyTips）', () => {
  it('一覧に無い id と重複を捨て、2件まで', () => {
    const got = parseBriefResult(
      {
        studyTips: [
          { id: 'recall', reason: '覚えたつもりで抜けている' },
          { id: 'made-up', reason: 'x' },
          { id: 'recall', reason: '重複' },
          { id: 'careless', reason: '計算で落としている' },
          { id: 'redo-notebook', reason: '三つ目' },
        ],
      },
      ['score']
    );
    expect(got.studyTips).toEqual([
      { id: 'recall', reason: '覚えたつもりで抜けている' },
      { id: 'careless', reason: '計算で落としている' },
    ]);
  });

  it('数字入り・長すぎの理由は理由だけ落とす（選んだこと自体は残す）', () => {
    const got = parseBriefResult(
      {
        studyTips: [
          { id: 'recall', reason: '偏差値があと4足りない' },
          { id: 'careless', reason: 'あ'.repeat(61) },
        ],
      },
      ['score']
    );
    expect(got.studyTips).toEqual([
      { id: 'recall', reason: '' },
      { id: 'careless', reason: '' },
    ]);
  });

  it('システムプロンプトに一覧の id がすべて載っている', () => {
    const prompt = briefSystemPrompt();
    for (const t of STUDY_TIPS) expect(prompt).toContain(t.id);
  });
});
