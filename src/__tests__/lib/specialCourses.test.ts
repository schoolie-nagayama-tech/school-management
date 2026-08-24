import { describe, it, expect } from 'vitest';
import {
  formatTargetGrades,
  formatCourseScopeLabel,
  generateSessionDates,
  mergeSessionDates,
  resolveKoushuOverride,
  totalCourseFee,
  type SpecialCourseKoushuOverride,
} from '@/lib/utils/specialCourses';

describe('formatTargetGrades', () => {
  it('空配列は「全学年」', () => {
    expect(formatTargetGrades([])).toBe('全学年');
  });

  it('学年ラベルへ変換し、順不同で渡しても昇順で並べる', () => {
    expect(formatTargetGrades([9, 7, 8])).toBe('中1・中2・中3');
  });

  it('ラベル定義の無い学年は数値のまま出す（黙って落とさない）', () => {
    expect(formatTargetGrades([99])).toBe('99');
  });
});

describe('formatCourseScopeLabel', () => {
  it('学年×科目を「学年 / 科目」で組み立てる', () => {
    expect(formatCourseScopeLabel([9], '英語')).toBe('中3 / 英語');
  });

  it('科目未指定なら学年だけ', () => {
    expect(formatCourseScopeLabel([9], null)).toBe('中3');
  });

  it('科目が空白のみのときも学年だけ（空スラッシュを出さない）', () => {
    expect(formatCourseScopeLabel([9], '   ')).toBe('中3');
  });

  it('学年未指定＋科目ありは「全学年 / 科目」', () => {
    expect(formatCourseScopeLabel([], '数学')).toBe('全学年 / 数学');
  });
});

describe('generateSessionDates', () => {
  it('開始日から指定曜日の開催日を回数分並べる', () => {
    // 2026-08-01 は土曜。火(2)・木(4) を4回 → 8/4, 8/6, 8/11, 8/13
    const result = generateSessionDates('2026-08-01', [2, 4], '19:30', '21:00', 4);
    expect(result.map((s) => s.date)).toEqual([
      '2026-08-04',
      '2026-08-06',
      '2026-08-11',
      '2026-08-13',
    ]);
    expect(result[0]).toEqual({ date: '2026-08-04', start_time: '19:30', end_time: '21:00' });
  });

  it('開始日がその曜日そのものなら初回に含める', () => {
    const result = generateSessionDates('2026-08-04', [2], '10:00', '11:00', 1);
    expect(result.map((s) => s.date)).toEqual(['2026-08-04']);
  });

  it('曜日未選択・回数0・開始日なしは空配列（入力ミスで無限に生成しない）', () => {
    expect(generateSessionDates('2026-08-01', [], '19:30', '21:00', 4)).toEqual([]);
    expect(generateSessionDates('2026-08-01', [2], '19:30', '21:00', 0)).toEqual([]);
    expect(generateSessionDates('', [2], '19:30', '21:00', 4)).toEqual([]);
  });
});

describe('mergeSessionDates', () => {
  const s = (date: string, start = '19:30', end = '21:00') => ({
    date,
    start_time: start,
    end_time: end,
  });

  it('同一日時の重複は追加せず、日付順に並べ直す', () => {
    const merged = mergeSessionDates(
      [s('2026-08-06'), s('2026-08-04')],
      [s('2026-08-04'), s('2026-08-11')]
    );
    expect(merged.map((x) => x.date)).toEqual(['2026-08-04', '2026-08-06', '2026-08-11']);
  });

  it('同じ日でも時刻が違えば別の回として残す', () => {
    const merged = mergeSessionDates([s('2026-08-04', '10:00', '11:00')], [s('2026-08-04')]);
    expect(merged).toHaveLength(2);
    expect(merged.map((x) => x.start_time)).toEqual(['10:00', '19:30']);
  });

  it('元の配列を書き換えない', () => {
    const existing = [s('2026-08-06')];
    mergeSessionDates(existing, [s('2026-08-04')]);
    expect(existing).toHaveLength(1);
  });
});

describe('resolveKoushuOverride', () => {
  const overrides: SpecialCourseKoushuOverride[] = [
    {
      course_id: 'c1',
      season: 'summer',
      year: 2026,
      session_dates: [{ date: '2026-08-04', start_time: '13:00', end_time: '14:30' }],
    },
    { course_id: 'c1', season: 'winter', year: 2026, session_dates: [] },
  ];

  it('上書きが無い講習期は overridden=false（通常の時間割どおり開催）', () => {
    expect(resolveKoushuOverride(overrides, 'spring', 2026)).toEqual({
      overridden: false,
      sessions: [],
    });
  });

  it('年が違えば別の講習期として扱う', () => {
    expect(resolveKoushuOverride(overrides, 'summer', 2027).overridden).toBe(false);
  });

  it('上書きがあれば overridden=true でその日時を返す', () => {
    const r = resolveKoushuOverride(overrides, 'summer', 2026);
    expect(r.overridden).toBe(true);
    expect(r.sessions).toHaveLength(1);
  });

  it('空配列の上書きは「この講習期は開催しない」意思表示として無指定と区別する', () => {
    expect(resolveKoushuOverride(overrides, 'winter', 2026)).toEqual({
      overridden: true,
      sessions: [],
    });
  });
});

describe('totalCourseFee', () => {
  it('単価×回数', () => {
    expect(totalCourseFee(3000, 8)).toBe(24000);
  });

  it('単価未設定は null（0円と混同させない）', () => {
    expect(totalCourseFee(null, 8)).toBeNull();
  });
});
