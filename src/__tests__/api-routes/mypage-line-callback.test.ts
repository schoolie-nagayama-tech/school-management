/**
 * APIルートテスト: /api/mypage/line/callback (GET)
 *
 * LINEログインのコールバック。ここはポータルのセッションを発行する入口なので、
 * 次の性質が壊れていないことを固定する:
 *   1) state 不一致（CSRF）を必ず拒否する
 *   2) 招待なしの未知LINEではアカウントを作らない（孤児アカウント防止）
 *   3) 他人に連携済みのLINEを既存セッションに奪わせない
 *   4) 正常系ではセッション cookie を張って所定の遷移先へ返す
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

// service role クライアント（実DBに触らない）
const mockAdmin = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/mypage/serviceClient', () => ({
  getPortalServiceClient: () => mockAdmin,
}));

// 既存セッションの有無をテストごとに差し替える
const ctxHolder = vi.hoisted(() => ({ ctx: null as null | { claims: { sub: string } } }));
vi.mock('@/lib/mypage/supabase', () => ({
  getPortalContext: vi.fn(async () => ctxHolder.ctx),
}));

// 署名鍵に依存させない
vi.mock('@/lib/mypage/jwt', () => ({
  signPortalJwt: vi.fn().mockResolvedValue('signed-jwt'),
}));

// LINEとの通信をモック（実APIを叩かない）
const lineHolder = vi.hoisted(() => ({
  profile: { userId: 'U-line-1', displayName: '山田 花子', pictureUrl: 'https://img/1' },
  shouldThrow: false,
}));
vi.mock('@/lib/mypage/line', () => ({
  buildRedirectUri: () => 'http://localhost:3000/api/mypage/line/callback',
  exchangeCodeForIdToken: vi.fn(async () => {
    if (lineHolder.shouldThrow) throw new Error('boom');
    return 'id-token';
  }),
  verifyIdToken: vi.fn(async () => lineHolder.profile),
}));

import { GET } from '@/app/api/mypage/line/callback/route';

const STATE = 'state-abc';
const NONCE = 'nonce-abc';

/** state cookie を積んだコールバックリクエストを作る。 */
function makeRequest(opts?: {
  code?: string | null;
  state?: string | null;
  cookieState?: { state: string; nonce: string; invite?: string } | null;
  error?: string;
}) {
  const url = new URL('http://localhost:3000/api/mypage/line/callback');
  if (opts?.error) url.searchParams.set('error', opts.error);
  const code = opts?.code === undefined ? 'auth-code' : opts.code;
  const state = opts?.state === undefined ? STATE : opts.state;
  if (code) url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);

  const req = new NextRequest(url);
  const cookieState =
    opts?.cookieState === undefined ? { state: STATE, nonce: NONCE } : opts.cookieState;
  if (cookieState) {
    req.cookies.set('line_oauth_state', JSON.stringify(cookieState));
  }
  return req;
}

/** portal_accounts / portal_invitations のクエリ応答を組み立てる。 */
function mockTables(config: {
  /** line_user_id 検索の結果 */
  linkedAccount?: { id: string; display_name: string } | null;
  /** 招待の検索結果 */
  invitation?: { id: string; expires_at: string; accepted_at: string | null } | null;
  /** insert の結果 */
  created?: { id: string };
  /** update / insert のエラーコード */
  errorCode?: string;
}) {
  const updateSpy = vi.fn().mockResolvedValue({
    error: config.errorCode ? { code: config.errorCode, message: 'conflict' } : null,
  });

  mockAdmin.from.mockImplementation((table: string) => {
    if (table === 'portal_accounts') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: config.linkedAccount ?? null, error: null }),
          }),
        }),
        update: (values: unknown) => ({
          eq: (_col: string, val: string) => updateSpy(values, val),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: config.created ?? null,
              error: config.errorCode ? { code: config.errorCode, message: 'dup' } : null,
            }),
          }),
        }),
      };
    }
    if (table === 'portal_invitations') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: config.invitation ?? null, error: null }),
          }),
        }),
      };
    }
    throw new Error(`未設定のテーブル: ${table}`);
  });

  return { updateSpy };
}

/** 有効な招待（期限内・未受諾）。 */
function validInvitation() {
  return {
    id: 'inv-1',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    accepted_at: null,
  };
}

describe('/api/mypage/line/callback', () => {
  beforeEach(() => {
    mockAdmin.from.mockReset();
    ctxHolder.ctx = null;
    lineHolder.shouldThrow = false;
    lineHolder.profile = {
      userId: 'U-line-1',
      displayName: '山田 花子',
      pictureUrl: 'https://img/1',
    };
  });

  it('state がクエリと cookie で一致しない場合は拒否する（CSRF対策）', async () => {
    mockTables({});
    const res = await GET(makeRequest({ state: 'tampered' }));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('line_error=state_mismatch');
    // アカウント解決まで進んでいないこと
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('state cookie が無い場合も拒否する', async () => {
    mockTables({});
    const res = await GET(makeRequest({ cookieState: null }));

    expect(res.headers.get('location')).toContain('line_error=state_mismatch');
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('未ログイン・未知のLINE・招待なしではアカウントを作らない（孤児アカウント防止）', async () => {
    mockTables({ linkedAccount: null });
    const res = await GET(makeRequest());

    expect(res.headers.get('location')).toContain('line_error=no_invite');
  });

  it('招待が期限切れならアカウントを作らない', async () => {
    mockTables({
      linkedAccount: null,
      invitation: {
        id: 'inv-1',
        expires_at: new Date(Date.now() - 1000).toISOString(),
        accepted_at: null,
      },
    });
    const res = await GET(
      makeRequest({ cookieState: { state: STATE, nonce: NONCE, invite: 'tok-1' } })
    );

    expect(res.headers.get('location')).toContain('line_error=invite_invalid');
  });

  it('招待が受諾済みならアカウントを作らない', async () => {
    mockTables({
      linkedAccount: null,
      invitation: {
        id: 'inv-1',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        accepted_at: new Date().toISOString(),
      },
    });
    const res = await GET(
      makeRequest({ cookieState: { state: STATE, nonce: NONCE, invite: 'tok-1' } })
    );

    expect(res.headers.get('location')).toContain('line_error=invite_invalid');
  });

  it('有効な招待つきならアカウントを作り、招待ページへ戻す', async () => {
    mockTables({
      linkedAccount: null,
      invitation: validInvitation(),
      created: { id: 'acc-new' },
    });
    const res = await GET(
      makeRequest({ cookieState: { state: STATE, nonce: NONCE, invite: 'tok-1' } })
    );

    expect(res.headers.get('location')).toContain('/mypage/invite/tok-1');
    // セッション cookie が張られている
    expect(res.cookies.get('portal_session')?.value).toBe('signed-jwt');
    // 使い捨ての state cookie は破棄されている
    expect(res.cookies.get('line_oauth_state')?.value).toBe('');
  });

  it('既知のLINEならログインしてマイページへ', async () => {
    mockTables({ linkedAccount: { id: 'acc-1', display_name: '既存ユーザー' } });
    const res = await GET(makeRequest());

    expect(res.headers.get('location')).toContain('/mypage');
    expect(res.cookies.get('portal_session')?.value).toBe('signed-jwt');
  });

  it('ログイン済みで未使用のLINEなら既存アカウントに後付け紐づけする', async () => {
    ctxHolder.ctx = { claims: { sub: 'acc-me' } };
    const { updateSpy } = mockTables({ linkedAccount: null });

    const res = await GET(makeRequest());

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ line_user_id: 'U-line-1' }),
      'acc-me'
    );
    expect(res.headers.get('location')).toContain('/mypage');
  });

  it('ログイン済みでも他人に連携済みのLINEは奪わせない', async () => {
    ctxHolder.ctx = { claims: { sub: 'acc-me' } };
    const { updateSpy } = mockTables({
      linkedAccount: { id: 'acc-other', display_name: '別人' },
    });

    const res = await GET(makeRequest());

    expect(res.headers.get('location')).toContain('line_error=already_linked');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('LINEとの通信に失敗したらエラーとして戻す', async () => {
    lineHolder.shouldThrow = true;
    mockTables({});

    const res = await GET(makeRequest());

    expect(res.headers.get('location')).toContain('line_error=exchange_failed');
  });

  it('ユーザーが同意をキャンセルした場合はエラー表示せずログイン画面へ戻す', async () => {
    mockTables({});
    const res = await GET(makeRequest({ error: 'access_denied' }));

    expect(res.headers.get('location')).toContain('/mypage/login');
    expect(res.headers.get('location')).not.toContain('line_error');
  });
});
