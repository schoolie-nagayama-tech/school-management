/**
 * APIルートテスト: /api/admin/students/[studentId]/portal-links (GET / POST / DELETE)
 *
 * 生徒スコープの保護者ポータル紐づけ 一覧・追加・解除。教室長（manager）以上＋自教室スコープで閉じる。
 * 次が壊れていないことを固定する:
 *   1) 未認証は 401（DBに触れない）
 *   2) manager 未満（teacher）は 403（DBに触れない）
 *   3) ★他教室の生徒（auth.schoolIds に school_id が無い）は 403 で、解除（delete）へ進まない（IDOR防止）
 *   4) studentId が uuid でなければ 400
 *   5) 生徒が存在しなければ 404
 *   6) DELETE はその生徒×そのアカウントの portal_account_students だけ削除し、portal_accounts は消さない
 *   7) GET は has_line boolean を返し、line_user_id の値は漏らさない
 *   8) GET は友だち状態・兄弟（他の紐づく生徒）を返し、★他教室の兄弟は名前を出さない
 *   9) ★POST は「自教室の生徒に紐づくアカウント」以外を 403 で拒む（他家庭への誤紐づけ防止）
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

import { GET, POST, DELETE } from '@/app/api/admin/students/[studentId]/portal-links/route';

const STUDENT_ID = '22222222-2222-2222-2222-222222222222';
const SIBLING_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_SCHOOL_STUDENT_ID = '44444444-4444-4444-4444-444444444444';
const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111';
const SCHOOL_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SCHOOL_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** params は Promise で渡す（Next.js App Router のシグネチャに合わせる）。 */
function makeParams(studentId: string) {
  return { params: Promise.resolve({ studentId }) };
}

/** students の所属確認（gate）だけを返すモック片。各テストで使い回す。 */
function studentsTableMock(
  student: { id: string; school_id: string } | null = {
    id: STUDENT_ID,
    school_id: SCHOOL_ID,
  }
) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: student, error: null }),
      }),
    }),
  };
}

/** line_message_logs（直近の通知）の読み取り。GETの終盤で必ず1回叩かれる。 */
function logsTableMock(rows: unknown[] = []) {
  return {
    select: () => ({
      eq: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    }),
  };
}

function makeRequest(method: 'GET' | 'POST' | 'DELETE', body?: unknown) {
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
      if (table === 'students') return studentsTableMock();
      if (table === 'portal_account_students') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      }
      if (table === 'line_message_logs') return logsTableMock();
      throw new Error(`未設定のテーブル: ${table}`);
    });
    const res = await GET(makeRequest('GET'), makeParams(STUDENT_ID));
    expect(res.status).toBe(200);
  });

  it('POST も他教室の生徒は 403（紐づけの追加へ進まない）', async () => {
    mockStudentLookup({ id: STUDENT_ID, school_id: OTHER_SCHOOL_ID });
    const res = await POST(
      makeRequest('POST', { account_id: ACCOUNT_ID, relation: 'guardian' }),
      makeParams(STUDENT_ID)
    );
    expect(res.status).toBe(403);
    expect(mockAdmin.from).not.toHaveBeenCalledWith('portal_account_students');
  });
});

describe('GET /api/admin/students/[studentId]/portal-links', () => {
  /**
   * GET が叩くクエリを一式モックする。
   *   1) students … gate（所属確認）
   *   2) portal_account_students .eq(student_id) … この生徒の紐づけ
   *   3) portal_account_students .in(account_id).neq(student_id) … 兄弟の逆引き
   *   4) line_message_logs … 直近の通知
   */
  function mockGetQueries(options: { links: unknown[]; others?: unknown[]; logs?: unknown[] }) {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'students') return studentsTableMock();
      if (table === 'portal_account_students') {
        return {
          select: () => ({
            // この生徒の紐づけ
            eq: () => Promise.resolve({ data: options.links, error: null }),
            // 兄弟の逆引き
            in: () => ({
              neq: () => Promise.resolve({ data: options.others ?? [], error: null }),
            }),
          }),
        };
      }
      if (table === 'line_message_logs') return logsTableMock(options.logs ?? []);
      throw new Error(`未設定のテーブル: ${table}`);
    });
  }

  const linkedAccount = {
    account_id: ACCOUNT_ID,
    relation: 'guardian',
    relation_note: null,
    created_at: '2026-07-12T00:00:00.000Z',
    portal_accounts: {
      id: ACCOUNT_ID,
      display_name: '山田 太郎（父）',
      login_id: null,
      line_user_id: 'U-secret-line-id',
      line_followed: true,
      line_follow_updated_at: null,
      last_login_at: '2026-08-30T12:04:00.000Z',
    },
  };

  it('has_line boolean を返し、line_user_id の値は含めない', async () => {
    mockGetQueries({ links: [linkedAccount] });

    const res = await GET(makeRequest('GET'), makeParams(STUDENT_ID));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.accounts).toHaveLength(1);
    expect(json.accounts[0]).toMatchObject({
      account_id: ACCOUNT_ID,
      display_name: '山田 太郎（父）',
      has_line: true,
      line_followed: true,
      relation: 'guardian',
      relation_note: null,
      linked_at: '2026-07-12T00:00:00.000Z',
    });
    // ★ line_user_id の値そのものはレスポンスのどこにも出ない。
    expect(JSON.stringify(json)).not.toContain('U-secret-line-id');
    expect('line_user_id' in json.accounts[0]).toBe(false);
  });

  it('LINE未連携のアカウントは line_followed を null で返す（既定値 true を「友だち」と誤読させない）', async () => {
    mockGetQueries({
      links: [
        {
          ...linkedAccount,
          portal_accounts: {
            ...linkedAccount.portal_accounts,
            line_user_id: null,
            login_id: 'yamada',
            // DBの既定値は true だが、連携していないので意味を持たない。
            line_followed: true,
          },
        },
      ],
    });

    const res = await GET(makeRequest('GET'), makeParams(STUDENT_ID));
    const json = await res.json();
    expect(json.accounts[0].has_line).toBe(false);
    expect(json.accounts[0].line_followed).toBeNull();
  });

  it('★兄弟は自教室の生徒だけ返す（他教室の兄弟の名前は出さない）', async () => {
    mockGetQueries({
      links: [linkedAccount],
      others: [
        {
          account_id: ACCOUNT_ID,
          student_id: SIBLING_ID,
          students: {
            last_name: '山田',
            first_name: '花子',
            grade: 4,
            school_id: SCHOOL_ID, // 自教室 → 出る
          },
        },
        {
          account_id: ACCOUNT_ID,
          student_id: OTHER_SCHOOL_STUDENT_ID,
          students: {
            last_name: '山田',
            first_name: '次郎',
            grade: 8,
            school_id: OTHER_SCHOOL_ID, // 他教室 → 落とす
          },
        },
      ],
    });

    const res = await GET(makeRequest('GET'), makeParams(STUDENT_ID));
    const json = await res.json();
    expect(json.accounts[0].other_students).toEqual([
      { student_id: SIBLING_ID, student_name: '山田 花子', grade: 4 },
    ]);
    expect(JSON.stringify(json)).not.toContain('次郎');
  });

  it('直近の通知（line_message_logs）を返す', async () => {
    mockGetQueries({
      links: [linkedAccount],
      logs: [
        {
          id: 'log-1',
          kind: 'report_published',
          status: 'sent',
          detail: null,
          recipient_count: 1,
          created_at: '2026-08-29T10:12:00.000Z',
        },
      ],
    });

    const res = await GET(makeRequest('GET'), makeParams(STUDENT_ID));
    const json = await res.json();
    expect(json.recent_logs).toHaveLength(1);
    expect(json.recent_logs[0].kind).toBe('report_published');
  });
});

describe('POST /api/admin/students/[studentId]/portal-links（兄弟の紐づけ追加）', () => {
  /** 対象アカウントが「どの教室の生徒に紐づいているか」を返すモック（所属検証で使う）。 */
  function mockPostQueries(
    ownedSchoolIds: string[],
    upsert = vi.fn().mockResolvedValue({ error: null })
  ) {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'students') return studentsTableMock();
      if (table === 'portal_account_students') {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: ownedSchoolIds.map((sid, i) => ({
                  student_id: `s-${i}`,
                  students: { school_id: sid },
                })),
                error: null,
              }),
          }),
          upsert,
        };
      }
      throw new Error(`未設定のテーブル: ${table}`);
    });
    return upsert;
  }

  it('自教室の生徒に紐づくアカウントなら upsert して 200', async () => {
    const upsert = mockPostQueries([SCHOOL_ID]);
    const res = await POST(
      makeRequest('POST', { account_id: ACCOUNT_ID, relation: 'guardian' }),
      makeParams(STUDENT_ID)
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      {
        account_id: ACCOUNT_ID,
        student_id: STUDENT_ID,
        relation: 'guardian',
        relation_note: null,
      },
      { onConflict: 'account_id,student_id', ignoreDuplicates: true }
    );
  });

  it('★他教室の生徒にしか紐づいていないアカウントは 403（他家庭への誤紐づけ防止）', async () => {
    const upsert = mockPostQueries([OTHER_SCHOOL_ID]);
    const res = await POST(
      makeRequest('POST', { account_id: ACCOUNT_ID, relation: 'guardian' }),
      makeParams(STUDENT_ID)
    );
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('紐づけ0件のアカウント（残骸）も 403', async () => {
    const upsert = mockPostQueries([]);
    const res = await POST(
      makeRequest('POST', { account_id: ACCOUNT_ID, relation: 'guardian' }),
      makeParams(STUDENT_ID)
    );
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('relation が未指定・不正なら 400（DBに触れない）', async () => {
    mockStudentLookup({ id: STUDENT_ID, school_id: SCHOOL_ID });
    const res = await POST(
      makeRequest('POST', { account_id: ACCOUNT_ID, relation: 'father' }),
      makeParams(STUDENT_ID)
    );
    expect(res.status).toBe(400);
    expect(mockAdmin.from).not.toHaveBeenCalledWith('portal_account_students');
  });

  it('relation=other は続柄メモが必須（空なら 400）', async () => {
    mockStudentLookup({ id: STUDENT_ID, school_id: SCHOOL_ID });
    const res = await POST(
      makeRequest('POST', { account_id: ACCOUNT_ID, relation: 'other', relation_note: '  ' }),
      makeParams(STUDENT_ID)
    );
    expect(res.status).toBe(400);
    expect(mockAdmin.from).not.toHaveBeenCalledWith('portal_account_students');
  });

  it('account_id が uuid でなければ 400', async () => {
    mockStudentLookup({ id: STUDENT_ID, school_id: SCHOOL_ID });
    const res = await POST(
      makeRequest('POST', { account_id: 'bad', relation: 'guardian' }),
      makeParams(STUDENT_ID)
    );
    expect(res.status).toBe(400);
    expect(mockAdmin.from).not.toHaveBeenCalledWith('portal_account_students');
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
