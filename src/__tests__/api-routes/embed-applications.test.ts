/**
 * APIルートテスト: /api/embed/applications (GET / POST)
 * トークンベース認証の埋め込みウィジェットエンドポイント
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createMockSupabaseAdmin, createMockChain } from './helpers';

const mockAdmin = createMockSupabaseAdmin();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAdmin),
}));

function makeGetRequest(token?: string) {
  const url = token
    ? `http://localhost:3000/api/embed/applications?token=${token}`
    : 'http://localhost:3000/api/embed/applications';
  return new NextRequest(url);
}

function makePostRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/embed/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── GET テスト ──

describe('GET /api/embed/applications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('トークンなしで400を返す', async () => {
    const { GET } = await import('@/app/api/embed/applications/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('トークン');
  });

  it('無効なトークンで403を返す', async () => {
    mockAdmin.from.mockImplementation(() =>
      createMockChain(null, { code: 'PGRST116', message: 'not found' }) as never
    );

    const { GET } = await import('@/app/api/embed/applications/route');
    const res = await GET(makeGetRequest('invalid-token'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('無効');
  });

  it('有効なトークンで生徒・申込データを返す', async () => {
    const tokenData = { token: 'valid', school_id: 's1', is_active: true, embed_type: 'applications' };
    const students = [{ id: 'st1', last_name: '山田', first_name: '太郎', grade: 3, status: 'active' }];
    const items = [{ id: 'item1', name: '教材費', sort_order: 1 }];
    const applications = [{ id: 'app1', student_id: 'st1', item_id: 'item1', status: 'paid' }];
    const school = { name: 'テスト教室' };

    let callCount = 0;
    mockAdmin.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createMockChain(tokenData) as never;
      if (callCount === 2) return createMockChain(students) as never;
      if (callCount === 3) return createMockChain(items) as never;
      if (callCount === 4) return createMockChain(applications) as never;
      return createMockChain(school) as never;
    });

    const { GET } = await import('@/app/api/embed/applications/route');
    const res = await GET(makeGetRequest('valid-token'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.school_name).toBe('テスト教室');
    expect(body.students).toHaveLength(1);
    expect(body.items).toHaveLength(1);
    expect(body.applications).toHaveLength(1);
    expect(body.generated_at).toBeDefined();
  });
});

// ── POST テスト ──

describe('POST /api/embed/applications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('パラメータ不足で400を返す', async () => {
    const { POST } = await import('@/app/api/embed/applications/route');
    const res = await POST(makePostRequest({ token: 'valid' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('パラメータ');
  });

  it('無効なトークンで403を返す', async () => {
    mockAdmin.from.mockImplementation(() =>
      createMockChain(null, { code: 'PGRST116' }) as never
    );

    const { POST } = await import('@/app/api/embed/applications/route');
    const res = await POST(makePostRequest({
      token: 'bad', student_id: 'st1', item_id: 'i1', action: 'status',
    }));
    expect(res.status).toBe(403);
  });

  it('教室外の生徒で404を返す', async () => {
    const tokenData = { token: 'valid', school_id: 's1', is_active: true, embed_type: 'applications' };

    let callCount = 0;
    mockAdmin.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createMockChain(tokenData) as never;
      // 生徒が見つからない
      return createMockChain(null, { code: 'PGRST116' }) as never;
    });

    const { POST } = await import('@/app/api/embed/applications/route');
    const res = await POST(makePostRequest({
      token: 'valid', student_id: 'other-student', item_id: 'i1', action: 'status', value: 'paid',
    }));
    expect(res.status).toBe(404);
  });

  it('status=null で既存レコードを削除する', async () => {
    const tokenData = { token: 'valid', school_id: 's1', is_active: true, embed_type: 'applications' };
    const student = { id: 'st1' };
    const existing = { id: 'app1', status: 'paid', number_value: null, date_value: null };

    let callCount = 0;
    mockAdmin.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createMockChain(tokenData) as never;
      if (callCount === 2) return createMockChain(student) as never;
      if (callCount === 3) return createMockChain(existing) as never;
      return createMockChain(null) as never;
    });

    const { POST } = await import('@/app/api/embed/applications/route');
    const res = await POST(makePostRequest({
      token: 'valid', student_id: 'st1', item_id: 'i1', action: 'status', value: null,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('不明なactionで400を返す', async () => {
    const tokenData = { token: 'valid', school_id: 's1', is_active: true, embed_type: 'applications' };
    const student = { id: 'st1' };

    let callCount = 0;
    mockAdmin.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createMockChain(tokenData) as never;
      if (callCount === 2) return createMockChain(student) as never;
      return createMockChain(null) as never;
    });

    const { POST } = await import('@/app/api/embed/applications/route');
    const res = await POST(makePostRequest({
      token: 'valid', student_id: 'st1', item_id: 'i1', action: 'unknown',
    }));
    expect(res.status).toBe(400);
  });
});
