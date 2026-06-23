/**
 * callCoursePrepApi のキャッシュ自動無効化テスト
 *
 * 検証:
 *   - 書き込み成功時、対象 schoolId のキャッシュエントリが消える
 *   - 別 schoolId のキャッシュは影響を受けない
 *   - 書き込み失敗時はキャッシュ無効化されない
 *
 * アプローチ: vi.spyOn はモジュール内ローカル参照を捉えられないため、
 * キャッシュの実状態を fetch 呼び出し回数で間接的に検証する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}));

describe('callCoursePrepApi (キャッシュ無効化)', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('書き込み成功後は同 schoolId への batchFetch がキャッシュをスキップして再フェッチする', async () => {
    const mod = await import('@/lib/api/coursePrepApi');

    // 1回目 batchFetch: ネットワーク呼び出し
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { progress_items: [] } }),
    });
    await mod.batchFetchCoursePrepApi({ schoolId: 'school-a', season: 'summer', year: '2026' }, [
      'progress_items',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 2回目 batchFetch (同パラメータ): キャッシュヒットでネットワーク呼ばれない
    await mod.batchFetchCoursePrepApi({ schoolId: 'school-a', season: 'summer', year: '2026' }, [
      'progress_items',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 増えていない

    // 書き込み: callCoursePrepApi 成功
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    await mod.callCoursePrepApi('update_progress_item', 'school-a', { itemId: 'i1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 3回目 batchFetch (同パラメータ): キャッシュが無効化されているので再フェッチ
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { progress_items: [{ id: 'new' }] } }),
    });
    await mod.batchFetchCoursePrepApi({ schoolId: 'school-a', season: 'summer', year: '2026' }, [
      'progress_items',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 増えた = キャッシュが無効化された
  });

  it('別 schoolId への書き込みは対象外のキャッシュを残す', async () => {
    const mod = await import('@/lib/api/coursePrepApi');

    // school-a をキャッシュに入れる
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { progress_items: [] } }),
    });
    await mod.batchFetchCoursePrepApi({ schoolId: 'school-a', season: 'summer', year: '2026' }, [
      'progress_items',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // school-b に書き込み
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    await mod.callCoursePrepApi('update_progress_item', 'school-b', { itemId: 'i1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // school-a の batchFetch は引き続きキャッシュヒット
    await mod.batchFetchCoursePrepApi({ schoolId: 'school-a', season: 'summer', year: '2026' }, [
      'progress_items',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 増えない
  });

  it('書き込み失敗時はキャッシュを保持する', async () => {
    const mod = await import('@/lib/api/coursePrepApi');

    // キャッシュ投入
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { progress_items: [] } }),
    });
    await mod.batchFetchCoursePrepApi({ schoolId: 'school-a', season: 'summer', year: '2026' }, [
      'progress_items',
    ]);

    // 書き込み失敗
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'permission denied' }),
    });
    await expect(
      mod.callCoursePrepApi('update_progress_item', 'school-a', { itemId: 'i1' })
    ).rejects.toThrow('permission denied');

    // キャッシュは残っているのでフェッチ回数増えない
    await mod.batchFetchCoursePrepApi({ schoolId: 'school-a', season: 'summer', year: '2026' }, [
      'progress_items',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // batchFetch(1) + callApi失敗(1) のみ
  });
});
