/**
 * APIルートテスト: /api/attendance/teacher-profile (GET)
 *
 * 出勤簿ページの講師名を、anon 向け RLS ポリシーに頼らずサーバーで返す。
 * 固定したいこと: ログイン必須・担当範囲外は 404・返す列は最小限。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const TEACHER_ID = '11111111-1111-4111-8111-111111111111';

const tables: Record<string, { data: unknown; error: unknown }> = {};

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const result = () => tables[table] ?? { data: null, error: null };
  for (const m of ['select', 'eq', 'limit']) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => result());
  chain.then = (resolve: (v: unknown) => void) => resolve(result());
  return chain;
}

const mockAdmin = { from: vi.fn((table: string) => makeChain(table)) };

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAdmin),
}));
vi.mock('@/lib/api-error', () => ({ captureApiError: vi.fn() }));

const getApiAuth = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  getApiAuth: (...args: unknown[]) => getApiAuth(...args),
  isSchoolInScope: (id: string, ids: string[]) => ids.includes(id),
}));

function authAs(role: string, userId: string, schoolIds: string[]) {
  getApiAuth.mockResolvedValue({
    auth: { userId, role, schoolIds },
    cookieResponse: NextResponse.next(),
  });
}

function makeRequest(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return new NextRequest(`http://localhost:3000/api/attendance/teacher-profile?${qs}`);
}

describe('GET /api/attendance/teacher-profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(tables)) delete tables[k];
    tables.schools = { data: { id: 's1' }, error: null };
    tables.user_profiles = {
      data: {
        id: TEACHER_ID,
        display_name: '山田 太郎',
        email: 't@example.com',
        is_active: true,
      },
      error: null,
    };
    tables.user_schools = { data: [{ school_id: 's1' }], error: null };
    tables.attendance_sheets = { data: [], error: null };
  });

  it('未ログインは 401', async () => {
    getApiAuth.mockResolvedValue({ auth: null, cookieResponse: NextResponse.next() });
    const { GET } = await import('@/app/api/attendance/teacher-profile/route');
    const res = await GET(makeRequest({ schoolCode: 'NAGAYAMA', teacherId: TEACHER_ID }));
    expect(res.status).toBe(401);
  });

  it('本人は自分の名前を取得できる。返すのは id と表示名だけ', async () => {
    authAs('teacher', TEACHER_ID, ['s1']);
    const { GET } = await import('@/app/api/attendance/teacher-profile/route');
    const res = await GET(makeRequest({ schoolCode: 'NAGAYAMA', teacherId: TEACHER_ID }));
    const body = await res.json();
    expect(res.status).toBe(200);
    // display_name がある場合 email は返さない
    expect(body).toEqual({ teacher: { id: TEACHER_ID, display_name: '山田 太郎', email: null } });
  });

  it('担当範囲外の教室の講師は 404', async () => {
    authAs('manager', 'manager-1', ['s2']);
    const { GET } = await import('@/app/api/attendance/teacher-profile/route');
    const res = await GET(makeRequest({ schoolCode: 'NAGAYAMA', teacherId: TEACHER_ID }));
    expect(res.status).toBe(404);
  });

  it('その教室に所属も出勤簿も無い講師は 404', async () => {
    authAs('admin', 'admin-1', ['s1']);
    tables.user_schools = { data: [], error: null };
    const { GET } = await import('@/app/api/attendance/teacher-profile/route');
    const res = await GET(makeRequest({ schoolCode: 'NAGAYAMA', teacherId: TEACHER_ID }));
    expect(res.status).toBe(404);
  });

  // 異動で所属が外れても、過去の出勤簿は開けるようにする（getOrCreateAttendanceSheet と同じ扱い）
  it('所属が外れていても、その教室の出勤簿があれば取得できる', async () => {
    authAs('manager', 'manager-1', ['s1']);
    tables.user_schools = { data: [], error: null };
    tables.attendance_sheets = { data: [{ id: 'sheet-1' }], error: null };
    const { GET } = await import('@/app/api/attendance/teacher-profile/route');
    const res = await GET(makeRequest({ schoolCode: 'NAGAYAMA', teacherId: TEACHER_ID }));
    expect(res.status).toBe(200);
  });

  it('無効化された講師は 404', async () => {
    authAs('admin', 'admin-1', ['s1']);
    tables.user_profiles = {
      data: { id: TEACHER_ID, display_name: 'x', email: 'x', is_active: false },
      error: null,
    };
    const { GET } = await import('@/app/api/attendance/teacher-profile/route');
    const res = await GET(makeRequest({ schoolCode: 'NAGAYAMA', teacherId: TEACHER_ID }));
    expect(res.status).toBe(404);
  });

  it('保護者ロールは 403', async () => {
    authAs('parent', 'parent-1', ['s1']);
    const { GET } = await import('@/app/api/attendance/teacher-profile/route');
    const res = await GET(makeRequest({ schoolCode: 'NAGAYAMA', teacherId: TEACHER_ID }));
    expect(res.status).toBe(403);
  });

  it('teacherId が UUID でなければ 400', async () => {
    authAs('admin', 'admin-1', ['s1']);
    const { GET } = await import('@/app/api/attendance/teacher-profile/route');
    const res = await GET(makeRequest({ schoolCode: 'NAGAYAMA', teacherId: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });
});
