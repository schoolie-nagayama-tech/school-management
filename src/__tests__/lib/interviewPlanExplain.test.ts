/**
 * ⑤プラン提示の説明（lib/interview/planExplain.ts）のテスト。
 *
 * ★守りたいのは:
 *  - 結合グループの単元を二重に数えないこと（保護者が見た数字と面談の数字がずれる）
 *  - 下書きは申込コマ（0に戻されている）ではなく提案のコマで見せること
 *  - 定期テストの上下は両方の回に点がある科目だけで出すこと
 *  - AIへ送る行が「プラン: 科目 …」の形で、科目名を突き合わせに使えること
 */
import { describe, expect, it } from 'vitest';
import type { AssessmentWithScores } from '@/types/database';
import {
  buildPlanAiLines,
  buildPlanExplanation,
  MAX_UNIT_CHIPS,
  type PlanProposalDetail,
  type PlanUnitDetail,
} from '@/lib/interview/planExplain';
import { planSubjectsFromSections } from '@/lib/ai/interviewBrief';

function asm(category: string, scores: Record<string, number | null>): AssessmentWithScores {
  return {
    category,
    name_code: 'x',
    scores: Object.entries(scores).map(([subject, value]) => ({ subject, value })),
  } as unknown as AssessmentWithScores;
}

function unit(name: string, koma: number, extra: Partial<PlanUnitDetail> = {}): PlanUnitDetail {
  return {
    name,
    komaCount: koma,
    appliedKoma: koma,
    groupId: 0,
    appliedGroupId: 0,
    sortOrder: 0,
    reason: '',
    ...extra,
  };
}

function proposal(extra: Partial<PlanProposalDetail>): PlanProposalDetail {
  return {
    id: 'p',
    subject: '英語',
    textbookName: '中2英語',
    status: 'approved',
    theme: '',
    appliedKoma: null,
    units: [],
    ...extra,
  };
}

describe('buildPlanExplanation', () => {
  it('提案書が無ければ null（⑤に何も足さない）', () => {
    expect(buildPlanExplanation([], [])).toBeNull();
  });

  it('科目でまとめ、コマの多い順に並べる。状態は強いほうに丸める', () => {
    const got = buildPlanExplanation(
      [
        proposal({ id: 'a', subject: '数学', textbookName: '中2数学', appliedKoma: 4 }),
        proposal({
          id: 'b',
          subject: '英語',
          textbookName: '中2英語',
          appliedKoma: 6,
          theme: '文法',
        }),
        proposal({
          id: 'c',
          subject: '英語',
          textbookName: '英語長文',
          appliedKoma: 2,
          theme: '長文',
          status: 'sent',
        }),
      ],
      []
    );
    expect(got?.subjects.map((s) => [s.subject, s.koma])).toEqual([
      ['英語', 8],
      ['数学', 4],
    ]);
    expect(got?.subjects[0].textbooks).toEqual(['中2英語', '英語長文']);
    expect(got?.subjects[0].theme).toBe('文法／長文');
    expect(got?.totalKoma).toBe(12);
    expect(got?.status).toBe('approved');
  });

  it('結合グループは1枚の札にまとめ、コマは1回だけ数える', () => {
    const got = buildPlanExplanation(
      [
        proposal({
          status: 'draft',
          appliedKoma: 0,
          units: [
            unit('不定詞', 2, { groupId: 1, sortOrder: 1, appliedKoma: 0 }),
            unit('動名詞', 2, { groupId: 1, sortOrder: 2, appliedKoma: 0 }),
            unit('比較', 3, { sortOrder: 3, appliedKoma: 0 }),
          ],
        }),
      ],
      []
    );
    // ★下書きは申込コマが0に戻されているので、提案のコマで見せる
    expect(got?.subjects[0].units).toEqual([
      { name: '不定詞・動名詞', koma: 2 },
      { name: '比較', koma: 3 },
    ]);
    expect(got?.subjects[0].koma).toBe(5);
    expect(got?.status).toBe('draft');
  });

  it('申込で外した単元（0コマ）は出さず、札は先頭の数枚＋ほかN', () => {
    const units = [
      unit('外した単元', 2, { appliedKoma: 0, sortOrder: 0 }),
      ...Array.from({ length: MAX_UNIT_CHIPS + 2 }, (_, i) =>
        unit(`単元${i}`, 1, { sortOrder: i + 1 })
      ),
    ];
    const got = buildPlanExplanation([proposal({ units, appliedKoma: MAX_UNIT_CHIPS + 2 })], []);
    const s = got?.subjects[0];
    expect(s?.units).toHaveLength(MAX_UNIT_CHIPS);
    expect(s?.units[0].name).toBe('単元0');
    expect(s?.moreUnits).toBe(2);
  });

  it('定期テストの上下は、両方の回に点がある科目コードだけで出す（新しい順が先頭）', () => {
    const assessments = [
      asm('regular_test', { english: 60, math: 80 }),
      asm('regular_test', { jhs_english: 99, english: 68, math: null }),
    ];
    const got = buildPlanExplanation(
      [
        proposal({ id: 'a', subject: '英語', appliedKoma: 4 }),
        proposal({ id: 'b', subject: '数学', appliedKoma: 2 }),
      ],
      assessments
    );
    expect(got?.subjects[0].testChange).toEqual({ label: '定期テスト英語 −8', diff: -8 });
    // 前回の数学が未入力なので出さない
    expect(got?.subjects[1].testChange).toBeNull();
  });

  it('定期テストが1回しか無い・科目が読めないときは出さない', () => {
    expect(
      buildPlanExplanation(
        [proposal({ appliedKoma: 2 })],
        [asm('regular_test', { english: 60 }), asm('mock', { english: 50 })]
      )?.subjects[0].testChange
    ).toBeNull();
    expect(
      buildPlanExplanation(
        [proposal({ subject: '科目不明', appliedKoma: 2 })],
        [asm('regular_test', { english: 60 }), asm('regular_test', { english: 50 })]
      )?.subjects[0].testChange
    ).toBeNull();
  });
});

describe('buildPlanAiLines', () => {
  it('科目ごと1行・「プラン:」で始まり、科目名を突き合わせに使える', () => {
    const plan = buildPlanExplanation(
      [
        proposal({
          subject: '英 語',
          theme: '文法の土台',
          appliedKoma: 6,
          units: [unit('不定詞', 3, { sortOrder: 1 }), unit('比較', 3, { sortOrder: 2 })],
        }),
      ],
      []
    );
    const lines = buildPlanAiLines(plan);
    // ★科目名の空白は詰める（空白までを科目名として読むため）
    expect(lines).toEqual([
      'プラン: 英語 6コマ：教材「中2英語」／テーマ：文法の土台／単元：不定詞・比較',
    ]);
    expect(planSubjectsFromSections([{ key: 'koushu', current: lines }])).toEqual(['英語']);
    expect(buildPlanAiLines(null)).toEqual([]);
  });
});
