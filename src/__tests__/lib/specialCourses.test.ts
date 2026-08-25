import { describe, it, expect } from 'vitest';
import {
  formatTargetGrades,
  formatCourseScopeLabel,
  generateSessionDates,
  mergeSessionDates,
  resolveKoushuOverride,
  filterCoursesForCell,
  formatWeeklySlotLabel,
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

describe('filterCoursesForCell', () => {
  // 永山校の実データ相当（中1理A=月19:10 / 中1社A=火19:10 / 中2理A=月20:20）
  const courses = [
    { id: 'a', name: '中1理A', day_of_week: 1, time_slot_id: 'slot-1910' },
    { id: 'b', name: '中1社A', day_of_week: 2, time_slot_id: 'slot-1910' },
    { id: 'c', name: '中2理A', day_of_week: 1, time_slot_id: 'slot-2020' },
    { id: 'd', name: '中2社A', day_of_week: 1, time_slot_id: 'slot-1910' },
  ];

  it('曜日とコマの両方が一致する講座だけを返す', () => {
    expect(filterCoursesForCell(courses, 1, 'slot-1910').map((c) => c.id)).toEqual(['a', 'd']);
  });

  it('曜日が違えば除外する（月の講座を火のセルに出さない）', () => {
    expect(filterCoursesForCell(courses, 2, 'slot-1910').map((c) => c.id)).toEqual(['b']);
  });

  it('コマが違えば除外する', () => {
    expect(filterCoursesForCell(courses, 1, 'slot-2020').map((c) => c.id)).toEqual(['c']);
  });

  it('曜日・コマが未設定の講座は候補に出さない', () => {
    const withUnset = [
      { id: 'x', day_of_week: null, time_slot_id: null },
      { id: 'y', day_of_week: 1, time_slot_id: null },
      { id: 'z', day_of_week: null, time_slot_id: 'slot-1910' },
      { id: 'a', day_of_week: 1, time_slot_id: 'slot-1910' },
    ];
    expect(filterCoursesForCell(withUnset, 1, 'slot-1910').map((c) => c.id)).toEqual(['a']);
  });

  it('日曜(0)も曜日として扱う（未設定と混同しない）', () => {
    const sunday = [{ id: 's', day_of_week: 0, time_slot_id: 'slot-1000' }];
    expect(filterCoursesForCell(sunday, 0, 'slot-1000').map((c) => c.id)).toEqual(['s']);
  });

  it('元の並び順を保つ（講座名順のまま画面に出す）', () => {
    const same = [
      { id: '1', day_of_week: 1, time_slot_id: 'slot-1910' },
      { id: '2', day_of_week: 1, time_slot_id: 'slot-1910' },
      { id: '3', day_of_week: 1, time_slot_id: 'slot-1910' },
    ];
    expect(filterCoursesForCell(same, 1, 'slot-1910').map((c) => c.id)).toEqual(['1', '2', '3']);
  });

  it('空配列を渡せば空配列', () => {
    expect(filterCoursesForCell([], 1, 'slot-1910')).toEqual([]);
  });

  it('一致0件でも例外にせず空配列を返す', () => {
    expect(filterCoursesForCell(courses, 6, 'slot-1910')).toEqual([]);
  });
});

describe('formatWeeklySlotLabel', () => {
  const slot = { start_time: '19:10:00', end_time: '20:10:00' };

  it('「曜日 開始-終了」で組み立てる（秒は落とす）', () => {
    expect(formatWeeklySlotLabel(1, 'slot-1910', slot)).toBe('月 19:10-20:10');
  });

  it('曜日かコマが未設定なら null（呼び出し側で「未設定」を出す）', () => {
    expect(formatWeeklySlotLabel(null, 'slot-1910', slot)).toBeNull();
    expect(formatWeeklySlotLabel(1, null, null)).toBeNull();
  });

  it('コマ時間が見つからないときは曜日だけ返す（設定を黙って消さない）', () => {
    expect(formatWeeklySlotLabel(3, 'slot-deleted', undefined)).toBe('水');
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
