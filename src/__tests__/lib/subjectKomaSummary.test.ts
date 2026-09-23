/**
 * 生徒別の提案書一覧の「科目ごとのコマ数」。
 *
 * ★過去問（教材の科目が空）のコマは単元の科目で各科目に振り分ける。
 *   以前は全部「その他」に落ちていた。テンプレでは「数学テキスト＋過去問の数学」が1パックなので、
 *   科目ごとの数にパックの総量が出ることを固定する。
 */
import { describe, it, expect } from 'vitest';
import {
  itemIdsNeedingSubject,
  summarizeKomaBySubject,
  UNKNOWN_SUBJECT,
} from '@/lib/proposals/subjectKomaSummary';
import type { SeasonalProposalWithDetails } from '@/types/database';

type P = Pick<SeasonalProposalWithDetails, 'units' | 'textbook'>;

function unit(curriculum_item_id: number, koma_count: number, group_id = 0) {
  return { curriculum_item_id, koma_count, group_id } as P['units'][number];
}
function proposal(subject: string | null, units: P['units']): P {
  return { textbook: { subject } as P['textbook'], units };
}

describe('summarizeKomaBySubject', () => {
  it('過去問のコマを単元の科目に振り分け、テキストの提案書と同じ科目に足す', () => {
    const math = proposal('数学', [unit(1, 6), unit(2, 4)]);
    const kakomon = proposal(null, [unit(100, 3), unit(101, 2), unit(200, 5)]);
    const subjects = new Map<number, string | null>([
      [100, '数学'],
      [101, '数学'],
      [200, '英語'],
    ]);

    const { subjects: out, total } = summarizeKomaBySubject([math, kakomon], subjects);

    expect(out).toEqual([
      { subject: '英語', koma: 5 },
      { subject: '数学', koma: 15 },
    ]);
    expect(total).toBe(20);
  });

  it('単元の科目が引けない過去問は「その他」に落とし、最後に並べる', () => {
    const { subjects } = summarizeKomaBySubject(
      [proposal(null, [unit(100, 2)]), proposal('国語', [unit(1, 3)])],
      new Map()
    );
    expect(subjects.map((s) => s.subject)).toEqual(['国語', UNKNOWN_SUBJECT]);
  });

  it('結合は1コマとして数え、科目の合計を足すと全体の合計に一致する', () => {
    // 同じ group_id の2単元（1つ目に4コマ、2つ目は0コマ）は4コマ。科目をまたいでも2重に数えない
    const kakomon = proposal(null, [unit(100, 4, 7), unit(200, 4, 7), unit(201, 1)]);
    const { subjects, total } = summarizeKomaBySubject(
      [kakomon],
      new Map<number, string | null>([
        [100, '数学'],
        [200, '英語'],
        [201, '英語'],
      ])
    );
    expect(total).toBe(5);
    expect(subjects.reduce((sum, s) => sum + s.koma, 0)).toBe(total);
    expect(subjects.find((s) => s.subject === '数学')?.koma).toBe(4);
  });

  it('0コマの単元は科目を生まない', () => {
    const { subjects } = summarizeKomaBySubject(
      [proposal(null, [unit(100, 0)])],
      new Map([[100, '理科']])
    );
    expect(subjects).toEqual([]);
  });
});

describe('itemIdsNeedingSubject', () => {
  it('過去問の提案書の単元だけを返す（ふつうの教材は問い合わせない）', () => {
    const ids = itemIdsNeedingSubject([
      proposal('数学', [unit(1, 2)]),
      proposal(null, [unit(100, 1), unit(101, 0)]),
      proposal('', [unit(300, 1)]),
    ]);
    expect(ids.sort((a, b) => a - b)).toEqual([100, 101, 300]);
  });
});
