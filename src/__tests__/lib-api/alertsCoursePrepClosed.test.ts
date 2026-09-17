/**
 * 講習準備アラート: 対象の期を実データから決める経路（fetchCoursePrepAlertData）
 *
 * 期の絞り込みそのものの境界は selectOpenCoursePrepPeriods のテストで固定してある。
 * ここで見るのは「絞り込んだ期に載っている項目だけを返す」という配線のほう。
 *  - 確定保存（締め）済みの期は丸ごと外す。進捗表が凍結されていて、今から埋めても
 *    確定データは変わらない＝消せないアラートになるため。
 *  - 終わった期の項目は、同じ教室に開いている期があっても混ざらない。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock は巻き上げられるため、ファクトリ内で完結させる。
// テーブルごとの戻り値は globalThis 経由でテストから差し替える。
vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const rows = () =>
      ((globalThis as Record<string, unknown>).__mockTables as Record<string, unknown[]>)?.[
        table
      ] ?? [];
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'in', 'eq', 'not', 'order', 'range']) {
      builder[method] = () => builder;
    }
    // await できるようにする（Promise.all / fetchAllPaged から使われる）
    builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: rows(), error: null }));
    return builder;
  };
  const client = { from: (table: string) => makeBuilder(table) };
  return {
    supabase: client,
    getSupabaseBrowserClient: () => client,
    createSupabaseBrowserClient: () => client,
  };
});

import { fetchCoursePrepAlertData } from '@/lib/api/alerts';

// 今日は「冬期2026の準備が動いている」時点に固定する（夏期2026は8/31に終わっている）。
const TODAY = new Date('2026-09-17T09:00:00+09:00');

const WINTER = { season: 'winter', year: 2026, schedule_end_date: '2027-01-09' };
const SUMMER = { season: 'summer', year: 2026, schedule_end_date: '2026-08-31' };

const PERIODS = [
  { school_id: 'school-open', ...WINTER },
  { school_id: 'school-closed', ...WINTER },
];

// 冬期の項目（開いている期）と、終わった夏期の項目。夏期側は常に落ちるのが正しい。
const ITEMS = [
  {
    id: 'item-open',
    school_id: 'school-open',
    name: '提案書作成',
    column_type: 'check',
    deadline: '2026-10-10',
    ...WINTER,
  },
  {
    id: 'item-closed',
    school_id: 'school-closed',
    name: '提案書作成',
    column_type: 'check',
    deadline: '2026-10-10',
    ...WINTER,
  },
  {
    id: 'item-ended-season',
    school_id: 'school-open',
    name: '提案書作成',
    column_type: 'check',
    deadline: '2026-06-24',
    ...SUMMER,
  },
];

function setTables(
  snapshots: { school_id: string; season: string; year: number }[],
  periods: { school_id: string; season: string; year: number }[] = PERIODS
) {
  (globalThis as Record<string, unknown>).__mockTables = {
    course_prep_periods: periods,
    // 区分（受験生だけ講習が長い期）は、このテストでは使わない
    course_prep_tracks: [],
    course_prep_progress_items: ITEMS,
    course_prep_snapshots: snapshots,
    course_prep_student_progress: [],
  };
}

const closed = (school_id: string) => ({ school_id, season: 'winter', year: 2026 });

describe('fetchCoursePrepAlertData（対象の期を実データから決める）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('確定保存済みの教室の項目は返さない', async () => {
    setTables([closed('school-closed')]);
    const { items } = await fetchCoursePrepAlertData(['school-open', 'school-closed']);
    expect(items.map((i) => i.id)).toEqual(['item-open']);
  });

  it('全校が確定保存済みなら何も返さない', async () => {
    setTables([closed('school-open'), closed('school-closed')]);
    const { items, studentProgress } = await fetchCoursePrepAlertData([
      'school-open',
      'school-closed',
    ]);
    expect(items).toEqual([]);
    expect(studentProgress).toEqual([]);
  });

  it('確定保存が無ければ開いている期の全校ぶん返す', async () => {
    setTables([]);
    const { items } = await fetchCoursePrepAlertData(['school-open', 'school-closed']);
    expect(items.map((i) => i.id)).toEqual(['item-open', 'item-closed']);
  });

  it('終わった期の項目は、同じ教室に開いている期があっても混ざらない', async () => {
    // item-ended-season は夏期2026（8/31終了）の項目。9月の時点では対象外。
    // 月で期を決めていたころは、逆にこれ「だけ」が出て冬期が出なかった。
    setTables([]);
    const { items } = await fetchCoursePrepAlertData(['school-open', 'school-closed']);
    expect(items.map((i) => i.id)).not.toContain('item-ended-season');
    expect(items.map((i) => i.id)).toContain('item-open');
  });

  it('開いている期が1件も無ければ何も返さない（項目取得まで行かない）', async () => {
    setTables([], [{ school_id: 'school-open', ...SUMMER }]);
    const { items, studentProgress } = await fetchCoursePrepAlertData(['school-open']);
    expect(items).toEqual([]);
    expect(studentProgress).toEqual([]);
  });
});
