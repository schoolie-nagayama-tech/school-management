/**
 * APIルートテスト: /api/device-trust/*（教室端末マーク＝講師の教室外モードの錨）
 *
 * 正典: docs/classroom-device-plan.md §2
 *
 * 次が壊れていないことを固定する:
 *   1) status は未認証だと 401（DBに触れない）
 *   2) status はクッキーのトークンを hash 照合し trusted を返す。失効済み（revoked_at）は false
 *   3) register / revoke は manager 未満を弾く（requireManager）
 *   4) ★ register は body の schoolId が自教室でなければ 403（IDOR防止・DBに触れない）
 *   5) ★ revoke は対象端末の school_id が自教室でなければ 403（更新へ進まない）
 *   6) revoke 後は status が false（revoked_at is null の条件が効いている）
 *   7) レスポンスに token_hash も平文トークンも載らない
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const SCHOOL_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SCHOOL_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DEVICE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TOKEN = 'a'.repeat(64);
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex');

// 認証情報はテストごとに差し替える。requireManager / isSchoolInScope は
// 本物と同じ判定ロジックを authHolder から組み立てて再現する。
const authHolder = vi.hoisted(() => ({
  auth: null as null | { userId: string; role: string; schoolIds: string[] },
}));
vi.mock('@/lib/api-auth', () => ({
  getApiAuth: vi.fn(async () => ({
    auth: authHolder.auth,
    cookieResponse: NextResponse.next(),
  })),
  requireManager: vi.fn(async () => {
    if (!authHolder.auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    const role = authHolder.auth.role.toLowerCase();
    if (role !== 'admin' && role !== 'owner' && role !== 'manager') {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }
    return null;
  }),
  isSchoolInScope: (targetSchoolId: string, callerSchoolIds: string[]) =>
    callerSchoolIds.includes(targetSchoolId),
}));

// service role クライアントを差し替える（実DB・実鍵に触らない）
const mockAdmin = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAdmin),
}));

import { GET as statusGET } from '@/app/api/device-trust/status/route';
import { POST as registerPOST } from '@/app/api/device-trust/register/route';
import { POST as revokePOST } from '@/app/api/device-trust/revoke/route';

/** trusted_devices の照合クエリ（select→eq→is→maybeSingle）をモックする。 */
function mockDeviceLookup(row: Record<string, unknown> | null) {
  const eqCalls: unknown[][] = [];
  mockAdmin.from.mockImplementation((table: string) => {
    if (table !== 'trusted_devices') throw new Error(`想定外のテーブル: ${table}`);
    return {
      select: () => ({
        eq: (...args: unknown[]) => {
          eqCalls.push(args);
          return {
            is: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }),
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          };
        },
      }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    };
  });
  return eqCalls;
}

function statusRequest(withCookie: boolean) {
  const req = new NextRequest('http://localhost:3000/api/device-trust/status');
  if (withCookie) req.cookies.set('nest_trusted_device', TOKEN);
  return req;
}

function jsonRequest(path: string, body: unknown) {
  return new NextRequest(`http://localhost:3000/api/device-trust/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authHolder.auth = { userId: 'u-manager', role: 'manager', schoolIds: [SCHOOL_ID] };
});

describe('GET /api/device-trust/status', () => {
  it('未認証は 401（DBに触らない）', async () => {
    authHolder.auth = null;
    const res = await statusGET(statusRequest(true));
    expect(res.status).toBe(401);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('クッキーが無ければ trusted=false（DBに触らない）', async () => {
    authHolder.auth = { userId: 'u-teacher', role: 'teacher', schoolIds: [SCHOOL_ID] };
    const res = await statusGET(statusRequest(false));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trusted: false });
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('クッキーのトークンを sha256 で照合し trusted=true を返す', async () => {
    authHolder.auth = { userId: 'u-teacher', role: 'teacher', schoolIds: [SCHOOL_ID] };
    const eqCalls = mockDeviceLookup({
      id: DEVICE_ID,
      school_id: SCHOOL_ID,
      label: '受付PC',
      // 直前に更新済みなら last_seen_at は書き直さない（間引き）
      last_seen_at: new Date().toISOString(),
    });

    const res = await statusGET(statusRequest(true));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trusted: true });
    // 平文ではなく hash で引いている
    expect(eqCalls[0]).toEqual(['token_hash', TOKEN_HASH]);
  });

  it('失効済み（照合ヒットしない）なら trusted=false', async () => {
    authHolder.auth = { userId: 'u-teacher', role: 'teacher', schoolIds: [SCHOOL_ID] };
    // revoked_at is null の条件で弾かれた状態＝ヒット無し
    mockDeviceLookup(null);

    const res = await statusGET(statusRequest(true));
    expect(await res.json()).toEqual({ trusted: false });
  });

  it('DBエラー時は信頼しない側に倒す（trusted=false）', async () => {
    authHolder.auth = { userId: 'u-teacher', role: 'teacher', schoolIds: [SCHOOL_ID] };
    mockAdmin.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
    }));

    const res = await statusGET(statusRequest(true));
    expect(await res.json()).toEqual({ trusted: false });
  });
});

describe('POST /api/device-trust/register', () => {
  it('未認証は 401（DBに触らない）', async () => {
    authHolder.auth = null;
    const res = await registerPOST(jsonRequest('register', { label: 'PC', schoolId: SCHOOL_ID }));
    expect(res.status).toBe(401);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('manager 未満（teacher）は 403（DBに触らない）', async () => {
    authHolder.auth = { userId: 'u-teacher', role: 'teacher', schoolIds: [SCHOOL_ID] };
    const res = await registerPOST(jsonRequest('register', { label: 'PC', schoolId: SCHOOL_ID }));
    expect(res.status).toBe(403);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('他教室の schoolId は 403（IDOR防止・DBに触らない）', async () => {
    const res = await registerPOST(
      jsonRequest('register', { label: 'PC', schoolId: OTHER_SCHOOL_ID })
    );
    expect(res.status).toBe(403);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('ラベルが空なら 400（DBに触らない）', async () => {
    const res = await registerPOST(jsonRequest('register', { label: '  ', schoolId: SCHOOL_ID }));
    expect(res.status).toBe(400);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('登録に成功すると httpOnly クッキーを返し、トークンはレスポンス本文に載せない', async () => {
    let inserted: Record<string, unknown> | null = null;
    mockAdmin.from.mockImplementation((table: string) => {
      expect(table).toBe('trusted_devices');
      return {
        insert: (row: Record<string, unknown>) => {
          inserted = row;
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: DEVICE_ID, label: '受付PC' }, error: null }),
            }),
          };
        },
      };
    });

    const res = await registerPOST(
      jsonRequest('register', { label: '受付PC', schoolId: SCHOOL_ID })
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ id: DEVICE_ID, label: '受付PC' });

    // DBには hash だけ（平文トークンは保存しない）
    const row = inserted as unknown as Record<string, unknown>;
    expect(row).not.toBeNull();
    expect(row.school_id).toBe(SCHOOL_ID);
    expect(row.created_by).toBe('u-manager');
    expect(typeof row.token_hash).toBe('string');
    expect((row.token_hash as string).length).toBe(64);
    expect(row.token).toBeUndefined();

    // クッキーは httpOnly / SameSite=Lax / path=/ で2年
    const cookie = res.cookies.get('nest_trusted_device');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 365 * 2);
    // クッキーの平文トークンは、DBに入った hash と一致する
    expect(crypto.createHash('sha256').update(cookie!.value).digest('hex')).toBe(row.token_hash);
  });
});

describe('POST /api/device-trust/revoke', () => {
  it('manager 未満（teacher）は 403（DBに触らない）', async () => {
    authHolder.auth = { userId: 'u-teacher', role: 'teacher', schoolIds: [SCHOOL_ID] };
    const res = await revokePOST(jsonRequest('revoke', { deviceId: DEVICE_ID }));
    expect(res.status).toBe(403);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('他教室の端末は 403（更新に進まない）', async () => {
    const updateSpy = vi.fn();
    mockAdmin.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { id: DEVICE_ID, school_id: OTHER_SCHOOL_ID }, error: null }),
        }),
      }),
      update: updateSpy,
    }));

    const res = await revokePOST(jsonRequest('revoke', { deviceId: DEVICE_ID }));
    expect(res.status).toBe(403);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('存在しない端末は 404', async () => {
    mockAdmin.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }));

    const res = await revokePOST(jsonRequest('revoke', { deviceId: DEVICE_ID }));
    expect(res.status).toBe(404);
  });

  it('自教室の端末は revoked_at がセットされ、以後 status は false になる', async () => {
    let revokedAt: string | null = null;
    mockAdmin.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { id: DEVICE_ID, school_id: SCHOOL_ID }, error: null }),
        }),
      }),
      update: (patch: { revoked_at?: string }) => {
        revokedAt = patch.revoked_at ?? null;
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      },
    }));

    const res = await revokePOST(jsonRequest('revoke', { deviceId: DEVICE_ID }));
    expect(res.status).toBe(200);
    expect(revokedAt).not.toBeNull();

    // 失効後は revoked_at is null の照合に引っかからない＝ヒット無し
    authHolder.auth = { userId: 'u-teacher', role: 'teacher', schoolIds: [SCHOOL_ID] };
    mockDeviceLookup(null);
    const statusRes = await statusGET(statusRequest(true));
    expect(await statusRes.json()).toEqual({ trusted: false });
  });
});
