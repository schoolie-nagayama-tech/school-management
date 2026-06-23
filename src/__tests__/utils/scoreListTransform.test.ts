/**
 * scoreListTransform（成績一覧のデータ変換）のユニットテスト
 *
 * transformToScoreList は assessments を生徒ごと・時系列順に並べ、
 * 5科/9科合計・前回比(diff)・換算内申・偏差値を計算する純粋関数。
 * 「間違うと成績表示が狂う」中核ロジックなので、
 *   - 合計の計算（null科目を0扱いしない）
 *   - 前回比（一つ前の行との差分）
 *   - 時系列の並び順
 *   - カテゴリ別の挙動（内申=9科+換算内申 / 模試=偏差値）
 *   - 生徒の並び順（学年→かな）
 * を検証する。
 */
import { describe, it, expect } from 'vitest';
import { transformToScoreList, getGradeLabel } from '@/lib/utils/scoreListTransform';
import { GRADE_LABELS } from '@/types/database';
import type { AssessmentWithScores, Student } from '@/types/database';

// ── テスト用ファクトリ（関数が参照するフィールドだけ埋めて型は cast） ──

type ScorePair = { subject: string; value: number | null };

function makeAssessment(over: {
  id: string;
  grade: number;
  name_code: string;
  exam_month?: string | null;
  scores: ScorePair[];
}): AssessmentWithScores {
  return {
    exam_month: null,
    ...over,
  } as unknown as AssessmentWithScores;
}

function makeStudent(over: {
  id: string;
  grade: number;
  last_name?: string;
  first_name?: string;
  last_name_kana?: string;
  first_name_kana?: string;
}): Student {
  return {
    last_name: '姓',
    first_name: '名',
    last_name_kana: 'せい',
    first_name_kana: 'めい',
    school_id: 'school-1',
    school_name: null,
    ...over,
  } as unknown as Student;
}

const FIVE = (
  e: number | null,
  m: number | null,
  j: number | null,
  so: number | null,
  sc: number | null
): ScorePair[] => [
  { subject: 'english', value: e },
  { subject: 'math', value: m },
  { subject: 'japanese', value: j },
  { subject: 'social', value: so },
  { subject: 'science', value: sc },
];

describe('transformToScoreList - 定期テスト(regular_test)', () => {
  it('5科合計を計算し、2回目の行に前回比(diff)が入る', () => {
    const student = makeStudent({ id: 's1', grade: 8 });
    const assessments = [
      // わざと「後の試験」を先に渡し、時系列ソートされることも確認する
      makeAssessment({
        id: 'a2',
        grade: 8,
        name_code: 'term1_final',
        scores: FIVE(45, 55, 35, 25, 15),
      }),
      makeAssessment({
        id: 'a1',
        grade: 8,
        name_code: 'term1_mid',
        scores: FIVE(40, 50, 30, 20, 10),
      }),
    ];
    const result = transformToScoreList([student], new Map([['s1', assessments]]), 'regular_test');

    expect(result).toHaveLength(1);
    const rows = result[0].rows;
    // 中間 → 期末 の時系列順に並ぶ
    expect(rows.map((r) => r.nameCode)).toEqual(['term1_mid', 'term1_final']);

    // 1行目: 合計150, 前回が無いので diff は null
    expect(rows[0].fiveSum).toBe(150);
    expect(rows[0].fiveSumDiff).toBeNull();
    expect(rows[0].diffs.english).toBeNull();

    // 2行目: 合計175, 前回比 +25, 各科目の差分も計算される
    expect(rows[1].fiveSum).toBe(175);
    expect(rows[1].fiveSumDiff).toBe(25);
    expect(rows[1].diffs.english).toBe(5);
    expect(rows[1].diffs.math).toBe(5);
  });

  it('null の科目は0扱いせず合計から除外する', () => {
    const student = makeStudent({ id: 's1', grade: 8 });
    // 理科が null → 合計は 40+50+30+20 = 140（null を 0 とはしない）
    const assessments = [
      makeAssessment({
        id: 'a1',
        grade: 8,
        name_code: 'term1_mid',
        scores: FIVE(40, 50, 30, 20, null),
      }),
    ];
    const result = transformToScoreList([student], new Map([['s1', assessments]]), 'regular_test');
    expect(result[0].rows[0].fiveSum).toBe(140);
  });

  it('全科目 null の合計は null（0ではない）', () => {
    const student = makeStudent({ id: 's1', grade: 8 });
    const assessments = [
      makeAssessment({
        id: 'a1',
        grade: 8,
        name_code: 'term1_mid',
        scores: FIVE(null, null, null, null, null),
      }),
    ];
    const result = transformToScoreList([student], new Map([['s1', assessments]]), 'regular_test');
    expect(result[0].rows[0].fiveSum).toBeNull();
  });

  it('assessment が無い生徒は結果に含めない', () => {
    const s1 = makeStudent({ id: 's1', grade: 8 });
    const s2 = makeStudent({ id: 's2', grade: 8 });
    const result = transformToScoreList(
      [s1, s2],
      new Map([
        [
          's1',
          [
            makeAssessment({
              id: 'a1',
              grade: 8,
              name_code: 'term1_mid',
              scores: FIVE(40, 50, 30, 20, 10),
            }),
          ],
        ],
      ]),
      'regular_test'
    );
    // s2 は assessments が無いので除外される
    expect(result.map((r) => r.studentId)).toEqual(['s1']);
  });
});

describe('transformToScoreList - 内申(report_card)', () => {
  it('9科オール5で9科合計45・換算内申(都立)65', () => {
    const student = makeStudent({ id: 's1', grade: 9 });
    const nineAllFive: ScorePair[] = [
      { subject: 'english', value: 5 },
      { subject: 'math', value: 5 },
      { subject: 'japanese', value: 5 },
      { subject: 'social', value: 5 },
      { subject: 'science', value: 5 },
      { subject: 'music', value: 5 },
      { subject: 'art', value: 5 },
      { subject: 'tech_home', value: 5 },
      { subject: 'pe', value: 5 },
    ];
    const result = transformToScoreList(
      [student],
      new Map([
        ['s1', [makeAssessment({ id: 'a1', grade: 9, name_code: 'term1', scores: nineAllFive })]],
      ]),
      'report_card',
      'tokyo'
    );
    const row = result[0].rows[0];
    expect(row.nineSum).toBe(45);
    // 都立換算内申: 5科×1=25 + 実技4科×2=40 = 65
    expect(row.convertedNaishin).toBe(65);
  });
});

describe('transformToScoreList - 模試(mock)', () => {
  it('偏差値(hensa_3 / hensa_5)が取り込まれる', () => {
    const student = makeStudent({ id: 's1', grade: 9 });
    const scores: ScorePair[] = [
      { subject: 'english', value: 60 },
      { subject: 'math', value: 70 },
      { subject: 'japanese', value: 50 },
      { subject: 'hensa_3', value: 55 },
      { subject: 'hensa_5', value: 58 },
    ];
    const result = transformToScoreList(
      [student],
      new Map([
        [
          's1',
          [
            makeAssessment({
              id: 'a1',
              grade: 9,
              name_code: 'venue',
              exam_month: '2026-03-01',
              scores,
            }),
          ],
        ],
      ]),
      'mock'
    );
    const row = result[0].rows[0];
    expect(row.hensa3).toBe(55);
    expect(row.hensa5).toBe(58);
  });
});

describe('transformToScoreList - 生徒の並び順', () => {
  it('学年昇順 → かな順でソートされる', () => {
    const a1 = makeAssessment({
      id: 'a',
      grade: 7,
      name_code: 'term1_mid',
      scores: FIVE(1, 1, 1, 1, 1),
    });
    const students = [
      makeStudent({ id: 'older', grade: 9, last_name_kana: 'あ', first_name_kana: 'あ' }),
      makeStudent({ id: 'youngB', grade: 7, last_name_kana: 'さ', first_name_kana: 'き' }),
      makeStudent({ id: 'youngA', grade: 7, last_name_kana: 'あ', first_name_kana: 'き' }),
    ];
    const map = new Map([
      ['older', [a1]],
      ['youngB', [a1]],
      ['youngA', [a1]],
    ]);
    const result = transformToScoreList(students, map, 'regular_test');
    // 学年7(あ→さ) が先、学年9 が後
    expect(result.map((r) => r.studentId)).toEqual(['youngA', 'youngB', 'older']);
  });
});

describe('getGradeLabel', () => {
  it('定義済みの学年はラベルを返す', () => {
    const [gradeStr, label] = Object.entries(GRADE_LABELS)[0];
    expect(getGradeLabel(Number(gradeStr))).toBe(label);
  });

  it('未定義の学年はフォールバック表記', () => {
    expect(getGradeLabel(9999)).toBe('学年9999');
  });
});
