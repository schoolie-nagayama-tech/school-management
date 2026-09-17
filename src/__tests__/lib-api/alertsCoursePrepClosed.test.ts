/**
 * 講習準備アラート: 確定保存（締め）済みの期を対象から外す
 *
 * 進捗表は確定保存すると「当時の姿」に凍結されるが、アラートはライブ計算のままだった。
 * そのため締めたあとに入会した生徒が、未完了項目ぶんの期日超過アラートとして並び、
 * 今から進捗を埋めても確定データは変わらないので消せない、という状態になっていた。
 * 「確定済みの教室は丸ごと対象外」という境界をここで固定する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const ITEMS = [
  { id: 'item-open', school_id: 'school-open', name: '提案書作成', column_type: 'check' },
  { id: 'item-closed', school_id: 'school-closed', name: '提案書作成', column_type: 'check' },
];

function setTables(snapshots: { school_id: string }[]) {
  (globalThis as Record<string, unknown>).__mockTables = {
    course_prep_progress_items: ITEMS,
    course_prep_snapshots: snapshots,
    course_prep_student_progress: [],
  };
}

describe('fetchCoursePrepAlertData（確定保存済みの期を外す）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('確定保存済みの教室の項目は返さない', async () => {
    setTables([{ school_id: 'school-closed' }]);
    const { items } = await fetchCoursePrepAlertData(['school-open', 'school-closed']);
    expect(items.map((i) => i.id)).toEqual(['item-open']);
  });

  it('全校が確定保存済みなら何も返さない', async () => {
    setTables([{ school_id: 'school-open' }, { school_id: 'school-closed' }]);
    const { items, studentProgress } = await fetchCoursePrepAlertData([
      'school-open',
      'school-closed',
    ]);
    expect(items).toEqual([]);
    expect(studentProgress).toEqual([]);
  });

  it('確定保存が無ければ従来どおり全校ぶん返す', async () => {
    setTables([]);
    const { items } = await fetchCoursePrepAlertData(['school-open', 'school-closed']);
    expect(items.map((i) => i.id)).toEqual(['item-open', 'item-closed']);
  });
});
