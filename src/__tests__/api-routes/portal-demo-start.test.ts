/**
 * APIルートテスト: /api/portal-demo/start (POST)
 *
 * スタッフ（教室長以上）向けデモセッション発行の検証。
 * このエンドポイントは「フラグ OFF のまま /mypage を通す鍵」を発行するため、
 *   1) スタッフ認証で閉じていること
 *   2) 紐づけ生徒が全員ダミーでなければ発行を拒否すること（実データ到達の最後の砦）
 * の2点が壊れていないことを固定する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createMockChain } from './helpers';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/api-auth', () => ({
  requireManager: vi.fn().mockResolvedValue(null),
}));

// service role クライアントを直接差し替える（実DB・実鍵に触らない）。
const mockAdmin = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/mypage/serviceClient', () => ({
  getPortalServiceClient: () => mockAdmin,
}));

// 署名鍵（PORTAL_JWT_PRIVATE_JWK）に依存させない。demo オプションの受け渡しだけ見る。
vi.mock('@/lib/mypage/jwt', () => ({
  signPortalJwt: vi.fn().mockResolvedValue('signed-jwt'),
}));

// cookie 書き込み（next/headers）を回避する。
vi.mock('@/lib/mypage/session', () => ({
  setPortalSession: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from '@/app/api/portal-demo/start/route';
import { signPortalJwt } from '@/lib/mypage/jwt';
import { setPortalSession } from '@/lib/mypage/session';
import { requireManager } from '@/lib/api-auth';

const ACCOUNT = { id: 'acc-1', login_id: 'demo-parent', display_name: 'デモ保護者' };

/** 紐づけ生徒1件分の行を作る（既定は「安全なダミー」）。 */
function link(overrides?: { is_test?: boolean; is_demo?: boolean }) {
  return {
    student_id: 'stu-1',
    students: {
      id: 'stu-1',
      is_test: overrides?.is_test ?? true,
      schools: { id: 'sch-1', is_demo: overrides?.is_demo ?? true },
    },
  };
}

/**
 * ルートの2クエリ（portal_accounts → portal_account_students）に応答を割り当てる。
 */
function mockQueries(account: unknown, links: unknown, linkError: unknown = null) {
  let call = 0;
  mockAdmin.from.mockImplementation(() => {
    call++;
    // 1回目: portal_accounts の maybeSingle、2回目: portal_account_students の await
    if (call === 1) return createMockChain(account) as never;
    return createMockChain(links, linkError) as never;
  });
}

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/portal-demo/start', { method: 'POST' });
}

describe('POST /api/portal-demo/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireManager).mockResolvedValue(null);
  });

  it('紐づけ生徒が全員ダミーならデモセッションを発行する', async () => {
    mockQueries(ACCOUNT, [link(), link()]);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // demo クレーム付きで署名されること（これがフラグOFF下で /mypage を通る唯一の鍵）。
    expect(signPortalJwt).toHaveBeenCalledWith(ACCOUNT.id, { demo: true });
    expect(setPortalSession).toHaveBeenCalledWith('signed-jwt');
  });

  it('manager 未満は弾かれ、セッションを発行しない', async () => {
    vi.mocked(requireManager).mockResolvedValue(
      NextResponse.json({ error: '権限がありません' }, { status: 403 })
    );

    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(setPortalSession).not.toHaveBeenCalled();
  });

  it('デモアカウント未投入なら 503', async () => {
    mockQueries(null, []);

    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('デモデータが未投入です');
    expect(setPortalSession).not.toHaveBeenCalled();
  });

  it('紐づけ生徒がゼロなら 503（全員ダミー判定が vacuous に通らないこと）', async () => {
    mockQueries(ACCOUNT, []);

    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
    expect(setPortalSession).not.toHaveBeenCalled();
  });

  it('実データ生徒（is_test=false）が1人でも混ざれば発行を拒否する', async () => {
    // データ側の事故でデモアカウントに実生徒が紐づいた状況。RLS は「正当な紐づけ」として
    // 通してしまうため、ここで止まらないと実データが見えてしまう。
    mockQueries(ACCOUNT, [link(), link({ is_test: false })]);

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(signPortalJwt).not.toHaveBeenCalled();
    expect(setPortalSession).not.toHaveBeenCalled();
  });

  it('デモ教室でない生徒（is_demo=false）が混ざれば発行を拒否する', async () => {
    mockQueries(ACCOUNT, [link({ is_demo: false })]);

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(setPortalSession).not.toHaveBeenCalled();
  });

  it('紐づけの検証に失敗したら発行しない（安全側に倒す）', async () => {
    mockQueries(ACCOUNT, null, { message: 'boom' });

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(setPortalSession).not.toHaveBeenCalled();
  });
});
