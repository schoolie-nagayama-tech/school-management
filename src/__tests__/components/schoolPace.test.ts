import { describe, expect, it } from 'vitest';
import {
  computeSchoolPace,
  formatSchoolPaceDiff,
  type SchoolPaceCompared,
} from '@/components/students/hub/schoolPace';
import { reachedUnitTitle } from '@/components/students/hub/hubStatus';
import type { TextbookProgressData } from '@/app/interview/ProgressPanel';

const TODAY = '2026-09-30';

/** units: [単元名, 授業日の配列, 学校の到達日]。sortOrders を省くと並び順がそのまま sort_order */
function textbook(
  id: string,
  units: [string, string[], string | null][],
  opts: { season?: 'spring' | 'summer' | 'winter' | null; sortOrders?: number[] } = {}
): TextbookProgressData {
  return {
    textbook: {
      id,
      season: opts.season ?? null,
      textbook: { name: `教材${id}`, subject: 'math' },
    },
    rows: units.map(([title, dates, school], i) => ({
      title,
      sort_order: opts.sortOrders ? opts.sortOrders[i] : i,
      progress: {
        school_progress_date: school,
        lessons: dates.map((d) => ({ lesson_date: d })),
      },
    })),
  } as unknown as TextbookProgressData;
}

function compared(data: TextbookProgressData[]): SchoolPaceCompared[] {
  return computeSchoolPace(data, TODAY).filter(
    (e): e is SchoolPaceCompared => e.kind === 'compared'
  );
}

describe('computeSchoolPace', () => {
  it('学校より手前なら遅れ。差は間にある単元の数', () => {
    const [r] = compared([
      textbook('a', [
        ['正負の数', ['2026-04-10'], '2026-04-15'],
        ['文字式', [], '2026-05-20'],
        ['方程式', [], '2026-06-20'],
        ['比例', [], null],
      ]),
    ]);
    expect(r).toMatchObject({
      schoolUnit: '方程式',
      jukuUnit: '正負の数',
      diff: -2,
      status: 'behind',
    });
    expect(r.label).toBe('数学 教材a');
  });

  it('同じ単元なら同じ、学校より先なら先', () => {
    const same = textbook('s', [
      ['正負の数', ['2026-04-10'], '2026-04-15'],
      ['文字式', ['2026-05-10'], '2026-05-20'],
    ]);
    const ahead = textbook('h', [
      ['正負の数', ['2026-04-10'], '2026-04-15'],
      ['文字式', ['2026-05-10'], null],
      ['方程式', ['2026-06-10'], null],
    ]);
    const [s, h] = compared([same, ahead]);
    expect(s).toMatchObject({ diff: 0, status: 'same' });
    expect(h).toMatchObject({
      schoolUnit: '正負の数',
      jukuUnit: '方程式',
      diff: 2,
      status: 'ahead',
    });
  });

  it('未来の学校の日付（予定の入力）は到達に数えない', () => {
    const [r] = compared([
      textbook('a', [
        ['正負の数', ['2026-04-10'], '2026-04-15'],
        ['文字式', ['2026-05-10'], '2026-09-30'], // 今日は到達済み
        ['方程式', [], '2026-10-15'], // 予定
        ['比例', [], '2026-11-20'], // 予定
      ]),
    ]);
    expect(r).toMatchObject({ schoolUnit: '文字式', jukuUnit: '文字式', status: 'same' });
  });

  it('最深到達点どうしで比べる（学校の日付が抜けた単元や、先の未指導の単元で誤検知しない）', () => {
    // 学校の日付が途中の単元にしか無く、当塾は先まで進んでいる。先の単元は未指導だが遅れではない
    const [r] = compared([
      textbook('a', [
        ['正負の数', ['2026-04-10'], null],
        ['文字式', ['2026-05-10'], '2026-05-20'],
        ['方程式', ['2026-06-10'], null],
        ['比例', [], null],
        ['一次関数', [], '2026-12-01'],
      ]),
    ]);
    expect(r).toMatchObject({ schoolUnit: '文字式', jukuUnit: '方程式', diff: 1, status: 'ahead' });
  });

  it('当塾が未着手なら当塾は null で、学校の単元までの数だけ遅れ', () => {
    const [r] = compared([
      textbook('a', [
        ['正負の数', [], '2026-04-15'],
        ['文字式', [], '2026-05-20'],
      ]),
    ]);
    expect(r).toMatchObject({ jukuUnit: null, diff: -2, status: 'behind' });
  });

  it('学校進度の記録が無い（未来の日付だけも含む）テキストは比べず、記録なしとして返す', () => {
    const result = computeSchoolPace(
      [
        textbook('none', [['正負の数', ['2026-04-10'], null]]),
        textbook('future', [['正負の数', ['2026-04-10'], '2026-10-01']]),
      ],
      TODAY
    );
    expect(result).toEqual([
      { kind: 'no_school_record', textbookId: 'none', label: '数学 教材none' },
      { kind: 'no_school_record', textbookId: 'future', label: '数学 教材future' },
    ]);
  });

  it('講習のテキスト（季節の印あり）は比べない', () => {
    const result = computeSchoolPace(
      [
        textbook('regular', [['正負の数', ['2026-04-10'], '2026-04-15']]),
        textbook('summer', [['正負の数', [], '2026-04-15']], { season: 'summer' }),
      ],
      TODAY
    );
    expect(result.map((e) => e.textbookId)).toEqual(['regular']);
  });

  it('sort_order が飛び番でも、差は単元の数（sort_order の差ではない）', () => {
    const [r] = compared([
      textbook(
        'a',
        [
          ['正負の数', ['2026-04-10'], null],
          ['文字式', [], null],
          ['方程式', [], '2026-06-20'],
        ],
        { sortOrders: [10, 50, 200] }
      ),
    ]);
    expect(r).toMatchObject({ schoolUnit: '方程式', jukuUnit: '正負の数', diff: -2 });
  });

  it('sort_order の並びは取得順と違っても sort_order に従う', () => {
    const [r] = compared([
      textbook(
        'a',
        [
          ['方程式', [], '2026-06-20'],
          ['正負の数', ['2026-04-10'], null],
          ['文字式', ['2026-05-10'], null],
        ],
        { sortOrders: [30, 10, 20] }
      ),
    ]);
    expect(r).toMatchObject({ schoolUnit: '方程式', jukuUnit: '文字式', diff: -1 });
  });

  it('当塾の到達単元は「今の状態」の reachedUnitTitle と一致する（復習で戻っても下がらない）', () => {
    const tb = textbook('a', [
      ['正負の数', ['2026-04-10', '2026-09-20'], null],
      ['文字式', ['2026-05-10'], '2026-05-20'],
      ['方程式', [], null],
    ]);
    const [r] = compared([tb]);
    expect(r.jukuUnit).toBe(reachedUnitTitle(tb.rows));
    expect(r.jukuUnit).toBe('文字式');
  });
});

describe('formatSchoolPaceDiff', () => {
  it('遅れ・同じ・先', () => {
    expect(formatSchoolPaceDiff(-3)).toBe('3単元 遅れ');
    expect(formatSchoolPaceDiff(0)).toBe('同じ');
    expect(formatSchoolPaceDiff(2)).toBe('2単元 先');
  });
});
