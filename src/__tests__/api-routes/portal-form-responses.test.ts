/**
 * APIルートテスト: /api/portal/form-responses (POST)
 * 保護者ポータルのフォーム送信エンドポイント（認証不要）のテスト
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createMockSupabaseAdmin, createMockChain } from './helpers';

const mockAdmin = createMockSupabaseAdmin();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAdmin),
}));

// Google Calendar のモック
vi.mock('@/lib/google-calendar', () => ({
  createFurikaeCalendarEvents: vi.fn().mockResolvedValue(undefined),
}));

const validBody = {
  school_id: '550e8400-e29b-41d4-a716-446655440000',
  form_type: 'moshi',
  form_period: '2026-04',
  student_name: '山田太郎',
  grade: 3,
  response_data: { exam_type: 'regular' },
};

function makeRequest(body: Record<string, unknown> = validBody) {
  return new NextRequest('http://localhost:3000/api/portal/form-responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/portal/form-responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有効なリクエストでフォーム回答を作成できる', async () => {
    const period = {
      id: 'p1',
      is_active: true,
      is_archived: false,
      publish_start: '2020-01-01',
      publish_end: '2099-12-31',
    };
    const createdResponse = { id: 'resp-1', ...validBody };

    let callCount = 0;
    mockAdmin.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // form_periods チェック
        return createMockChain(period) as never;
      }
      if (callCount === 2) {
        // 二重送信ガードの候補取得（直近の同一内容なし）
        return createMockChain([]) as never;
      }
      if (callCount === 3) {
        // form_responses insert
        return createMockChain(createdResponse) as never;
      }
      // 後続の auto-link/billing/notification
      return createMockChain(null) as never;
    });

    const { POST } = await import('@/app/api/portal/form-responses/route');
    const req = makeRequest();
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeDefined();
    expect(body.data.id).toBe('resp-1');
  });

  it('直近の同一内容の再送信は新規作成せず既存レコードを返す', async () => {
    const period = {
      id: 'p1',
      is_active: true,
      is_archived: false,
      publish_start: '2020-01-01',
      publish_end: '2099-12-31',
    };
    // キー順を入れ替えても同一内容として扱えること（jsonb はキー順を正規化するため）
    const existing = {
      id: 'existing-1',
      student_name: '山田　太郎',
      email: null,
      response_data: { exam_type: 'regular' },
    };

    let callCount = 0;
    mockAdmin.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createMockChain(period) as never;
      if (callCount === 2) return createMockChain([existing]) as never;
      return createMockChain({ id: 'should-not-be-created' }) as never;
    });

    const { POST } = await import('@/app/api/portal/form-responses/route');
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(body.data.id).toBe('existing-1');
  });

  it('内容が違う再送信は正当な変更・追加申込として新規作成する', async () => {
    const period = {
      id: 'p1',
      is_active: true,
      is_archived: false,
      publish_start: '2020-01-01',
      publish_end: '2099-12-31',
    };
    const existing = {
      id: 'existing-1',
      student_name: '山田太郎',
      email: null,
      response_data: { exam_type: 'furikae' },
    };

    let callCount = 0;
    mockAdmin.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createMockChain(period) as never;
      if (callCount === 2) return createMockChain([existing]) as never;
      if (callCount === 3) return createMockChain({ id: 'resp-2' }) as never;
      return createMockChain(null) as never;
    });

    const { POST } = await import('@/app/api/portal/form-responses/route');
    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.duplicate).toBeUndefined();
    expect(body.data.id).toBe('resp-2');
  });

  it('バリデーション失敗で400を返す（school_idがUUIDでない）', async () => {
    const { POST } = await import('@/app/api/portal/form-responses/route');
    const req = makeRequest({ ...validBody, school_id: 'not-uuid' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('入力内容');
  });

  it('バリデーション失敗で400を返す（student_nameが空）', async () => {
    const { POST } = await import('@/app/api/portal/form-responses/route');
    const req = makeRequest({ ...validBody, student_name: '' });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('受付期間がアーカイブ済みの場合400を返す', async () => {
    const period = {
      id: 'p1',
      is_active: true,
      is_archived: true,
      publish_start: '2020-01-01',
      publish_end: '2099-12-31',
    };
    mockAdmin.from.mockImplementation(() => createMockChain(period) as never);

    const { POST } = await import('@/app/api/portal/form-responses/route');
    const req = makeRequest();
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('受付していません');
  });

  it('受付期間が非アクティブの場合400を返す', async () => {
    const period = {
      id: 'p1',
      is_active: false,
      is_archived: false,
      publish_start: '2020-01-01',
      publish_end: '2099-12-31',
    };
    mockAdmin.from.mockImplementation(() => createMockChain(period) as never);

    const { POST } = await import('@/app/api/portal/form-responses/route');
    const req = makeRequest();
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('受付期間が存在しない場合400を返す', async () => {
    mockAdmin.from.mockImplementation(() => createMockChain(null) as never);

    const { POST } = await import('@/app/api/portal/form-responses/route');
    const req = makeRequest();
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('公開開始前の場合400を返す', async () => {
    const period = {
      id: 'p1',
      is_active: true,
      is_archived: false,
      publish_start: '2099-01-01',
      publish_end: '2099-12-31',
    };
    mockAdmin.from.mockImplementation(() => createMockChain(period) as never);

    const { POST } = await import('@/app/api/portal/form-responses/route');
    const req = makeRequest();
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('受付していません');
  });

  it('公開終了後の場合400を返す', async () => {
    const period = {
      id: 'p1',
      is_active: true,
      is_archived: false,
      publish_start: '2020-01-01',
      publish_end: '2020-12-31',
    };
    mockAdmin.from.mockImplementation(() => createMockChain(period) as never);

    const { POST } = await import('@/app/api/portal/form-responses/route');
    const req = makeRequest();
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('終了');
  });

  it('重複回答(23505)で409を返す', async () => {
    const period = {
      id: 'p1',
      is_active: true,
      is_archived: false,
      publish_start: '2020-01-01',
      publish_end: '2099-12-31',
    };

    let callCount = 0;
    mockAdmin.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createMockChain(period) as never;
      // 二重送信ガードの候補取得（該当なし）
      if (callCount === 2) return createMockChain([]) as never;
      // insert で重複エラー
      return createMockChain(null, { code: '23505', message: 'duplicate' }) as never;
    });

    const { POST } = await import('@/app/api/portal/form-responses/route');
    const req = makeRequest();
    const res = await POST(req);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('既に送信');
  });
});
