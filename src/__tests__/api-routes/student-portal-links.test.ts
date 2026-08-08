/**
 * APIルートテスト: /api/admin/students/[studentId]/portal-links (GET / DELETE)
 *
 * 生徒スコープの保護者ポータル紐づけ一覧・解除。教室長（manager）以上＋自教室スコープで閉じる。
 * 次が壊れていないことを固定する:
 *   1) 未認証は 401（DBに触れない）
 *   2) manager 未満（teacher）は 403（DBに触れない）
 *   3) ★他教室の生徒（auth.schoolIds に school_id が無い）は 403 で、解除（delete）へ進まない（IDOR防止）
 *   4) studentId が uuid でなければ 400
 *   5) 生徒が存在しなければ 404
 *   6) DELETE はその生徒×そのアカウントの portal_account_students だけ削除し、portal_accounts は消さない
 *   7) GET は has_line boolean を返し、line_user_id の値は漏らさない
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

// 認証情報はテストごとに差し替える（getApiAuth を直接モック）。
const authHolder = vi.hoisted(() => ({
  auth: null as null | { userId: string; role: string; schoolIds: string[] },
}));
vi.mock('@/lib/api-auth', () => ({
  getApiAuth: vi.fn(async () => ({ auth: authHolder.auth, cookieResponse: undefined })),
}));

// service role クライアントを差し替える（実DB・実鍵に触らない）。
const mockAdmin = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/mypage/serviceClient', () => ({
  getPortalServiceClient: () => mockAdmin,
}));

import { GET, DELETE } from '@/app/api/admin/students/[studentId]/portal-links/route';

const STUDENT_ID = '22222222-2222-2222-2222-222222222222';
const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111';
const SCHOOL_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SCHOOL_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** params は Promise で渡す（Next.js App Router のシグネチャに合わせる）。 */
function makeParams(studentId: string) {
  return { params: Promise.resolve({ studentId }) };
}

function makeRequest(method: 'GET' | 'DELETE', body?: unknown) {
  return new NextRequest(`http://localhost:3000/api/admin/students/${STUDENT_ID}/portal-links`, {
    method,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

/** students テーブルの取得（select→eq→maybeSingle）だけをモックする。 */
function mockStudentLookup(student: { id: string; school_id: string } | null) {
  mockAdmin.from.mockImplementation((table: string) => {
    if (table === 'students') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: student, error: null }),
          }),
        }),
      };
    }
    throw new Error(`このテストでは students 以外に触れないはず: ${table}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authHolder.auth = { userId: 'u-manager', role: 'manager', schoolIds: [SCHOOL_ID] };
});

describe('認可・スコープ検証（GET/DELETE 共通の前段）', () => {
  it('未認証は 401（DBに触らない）', async () => {
    authHolder.auth = null;
    const res = await GET(makeRequest('GET'), makeParams(STUDENT_ID));
    expect(res.status).toBe(401);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('manager 未満（teacher）は 403（DBに触らない）', async () => {
    authHolder.auth = { userId: 'u-teacher', role: 'teacher', schoolIds: [SCHOOL_ID] };
    const res = await GET(makeRequest('GET'), makeParams(STUDENT_ID));
    expect(res.status).toBe(403);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('studentId が uuid でなければ 400（DBに触らない）', async () => {
    const res = await GET(makeRequest('GET'), makeParams('not-a-uuid'));
    expect(res.status).toBe(400);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('生徒が存在しなければ 404', async () => {
    mockStudentLookup(null);
    const res = await GET(makeRequest('GET'), makeParams(STUDENT_ID));
    expect(res.status).toBe(404);
    // students の参照だけで終わる（紐づけクエリへは進まない）。
    expect(mockAdmin.from).toHaveBeenCalledWith('students');
    expect(mockAdmin.from).not.toHaveBeenCalledWith('portal_account_students');
  });

  it('★他教室の生徒（schoolIds に無い）は 403 で、削除に進まない（IDOR防止）', async () => {
    // manager の所属は SCHOOL_ID のみ。生徒は OTHER_SCHOOL_ID に所属＝スコープ外。
    mockStudentLookup({ id: STUDENT_ID, school_id: OTHER_SCHOOL_ID });
    const res = await DELETE(
      makeRequest('DELETE', { account_id: ACCOUNT_ID }),
      makeParams(STUDENT_ID)
    );
    expect(res.status).toBe(403);
    // 生徒の所属確認まではするが、紐づけの delete には決して進まない。
    expect(mockAdmin.from).toHaveBeenCalledWith('students');
    expect(mockAdmin.from).not.toHaveBeenCalledWith('portal_account_students');
  });

  it('admin は全校スコープ（schoolIds に生徒の school_id が入っている前提）で通る', async () => {
    // getApiAuth は admin のとき schoolIds に全校を詰める実装。ここでは該当校を含める。
    authHolder.auth = { userId: 'u-admin', role: 'admin', schoolIds: [SCHOOL_ID, OTHER_SCHOOL_ID] };
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: STUDENT_ID, school_id: SCHOOL_ID }, error: null }),
            }),
          }),
        };
      }
      if (table === 'portal_account_students') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      }
      throw new Error(`未設定のテーブル: ${table}`);
    });
    const res = await GET(makeRequest('GET'), makeParams(STUDENT_ID));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/admin/students/[studentId]/portal-links', () => {
  it('has_line boolean を返し、line_user_id の値は含めない', async () => {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: STUDENT_ID, school_id: SCHOOL_ID }, error: null }),
            }),
          }),
        };
      }
      if (table === 'portal_account_students') {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [
                  {
                    account_id: ACCOUNT_ID,
                    relation: 'guardian',
                    relation_note: null,
                    portal_accounts: {
                      id: ACCOUNT_ID,
                      display_name: '山田 太郎（父）',
                      line_user_id: 'U-secret-line-id',
                    },
                  },
                ],
                error: null,
              }),
          }),
        };
      }
      throw new Error(`未設定のテーブル: ${table}`);
    });

    const res = await GET(makeRequest('GET'), makeParams(STUDENT_ID));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.accounts).toHaveLength(1);
    expect(json.accounts[0]).toEqual({
      account_id: ACCOUNT_ID,
      display_name: '山田 太郎（父）',
      has_line: true,
      relation: 'guardian',
      relation_note: null,
    });
    // ★ line_user_id の値そのものはレスポンスのどこにも出ない。
    expect(JSON.stringify(json)).not.toContain('U-secret-line-id');
    expect('line_user_id' in json.accounts[0]).toBe(false);
  });
});

describe('DELETE /api/admin/students/[studentId]/portal-links', () => {
  it('その生徒×そのアカウントの紐づけだけ削除し、portal_accounts は削除しない', async () => {
    const eqStudent = vi.fn().mockResolvedValue({ error: null });
    const eqAccount = vi.fn().mockReturnValue({ eq: eqStudent });
    const del = vi.fn().mockReturnValue({ eq: eqAccount });

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: STUDENT_ID, school_id: SCHOOL_ID }, error: null }),
            }),
          }),
        };
      }
      if (table === 'portal_account_students') {
        return { delete: del };
      }
      throw new Error(`削除で触れてよいのは students / portal_account_students のみ: ${table}`);
    });

    const res = await DELETE(
      makeRequest('DELETE', { account_id: ACCOUNT_ID }),
      makeParams(STUDENT_ID)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // portal_account_students に対し account_id と student_id の両方で絞って delete。
    expect(mockAdmin.from).toHaveBeenCalledWith('portal_account_students');
    // ★ アカウント本体は絶対に消さない。
    expect(mockAdmin.from).not.toHaveBeenCalledWith('portal_accounts');
    expect(eqAccount).toHaveBeenCalledWith('account_id', ACCOUNT_ID);
    expect(eqStudent).toHaveBeenCalledWith('student_id', STUDENT_ID);
  });

  it('account_id が uuid でなければ 400（生徒は通っても紐づけ削除に進まない）', async () => {
    mockStudentLookup({ id: STUDENT_ID, school_id: SCHOOL_ID });
    const res = await DELETE(makeRequest('DELETE', { account_id: 'bad' }), makeParams(STUDENT_ID));
    expect(res.status).toBe(400);
    expect(mockAdmin.from).not.toHaveBeenCalledWith('portal_account_students');
  });

  it('対象が存在しなくても 200（冪等）', async () => {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id: STUDENT_ID, school_id: SCHOOL_ID }, error: null }),
            }),
          }),
        };
      }
      // delete は該当0件でも error=null。
      return { delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) };
    });

    const res = await DELETE(
      makeRequest('DELETE', { account_id: ACCOUNT_ID }),
      makeParams(STUDENT_ID)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('JSON でない body は 400', async () => {
    mockStudentLookup({ id: STUDENT_ID, school_id: SCHOOL_ID });
    const res = await DELETE(makeRequest('DELETE', 'not json'), makeParams(STUDENT_ID));
    expect(res.status).toBe(400);
    expect(mockAdmin.from).not.toHaveBeenCalledWith('portal_account_students');
  });
});
