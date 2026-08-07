/**
 * APIルートテスト: /api/mypage/invite/accept の同意取得（P3-L4）＋ hasCurrentConsent
 *
 * 同意は「取れていること」より「取れていないのに先へ進めないこと」が本質なので、
 * 次を固定する:
 *   1) agreed が無い/false のリクエストは 400 で、DBに一切触らない
 *      （アカウント作成も紐づけも起きない）
 *   2) agreed=true の受諾では portal_consents に両文書ぶん2行が記録される
 *      （既ログイン・新規作成の両モード）
 *   3) 同意ログの記録に失敗したら 500（＝受諾を成功扱いにしない）。
 *      新規作成モードでは作りかけのアカウントを後始末し、招待も消費しない
 *   4) hasCurrentConsent が「片方だけ最新」「両方古い」「両方最新」を正しく判定する
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

// service role クライアント（実DBに触らない）。
// ルートと lib/mypage/legal.ts の両方が同じこのモックを掴む。
const mockAdmin = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/mypage/serviceClient', () => ({
  getPortalServiceClient: () => mockAdmin,
}));

// 既存セッションの有無をテストごとに差し替える（(a)/(b) モードの分岐）。
const ctxHolder = vi.hoisted(() => ({ ctx: null as null | { claims: { sub: string } } }));
vi.mock('@/lib/mypage/supabase', () => ({
  getPortalContext: vi.fn(async () => ctxHolder.ctx),
}));

// 署名鍵・cookie 書き込みに依存させない。
vi.mock('@/lib/mypage/jwt', () => ({
  signPortalJwt: vi.fn().mockResolvedValue('signed-jwt'),
}));
vi.mock('@/lib/mypage/session', () => ({
  setPortalSession: vi.fn().mockResolvedValue(undefined),
}));

// bcrypt の実ハッシュはテストの本題ではないので固定値に置き換える。
vi.mock('@/lib/mypage/password', () => ({
  validatePassword: (pw: unknown) =>
    typeof pw === 'string' && pw.length >= 8 ? null : 'パスワードは8文字以上で入力してください',
  hashPassword: async () => 'hashed',
}));

import { POST } from '@/app/api/mypage/invite/accept/route';
import { LEGAL_DOCUMENTS, hasCurrentConsent } from '@/lib/mypage/legal';

const STUDENT_ID = '00000000-0000-0000-0000-0000000000st';
const INVITATION_ID = 'inv-1';
const EXISTING_ACCOUNT_ID = 'acc-existing';
const CREATED_ACCOUNT_ID = 'acc-created';

/** テストごとに差し替えるDBの応答。 */
const state = vi.hoisted(() => ({
  invitation: null as Record<string, unknown> | null,
  consentInsertError: null as { message: string } | null,
  consentRows: [] as Array<{ document: string; version: string }>,
  consentSelectError: null as { message: string } | null,
}));

/** 「何が書かれたか」を見るためのスパイ。 */
const spies = vi.hoisted(() => ({
  consentInsert: vi.fn(),
  linkUpsert: vi.fn(),
  accountInsert: vi.fn(),
  accountDelete: vi.fn(),
  invitationUpdate: vi.fn(),
}));

/** supabase-js のビルダーを最小限だけ模したテーブル別モック。 */
function installTableMocks() {
  mockAdmin.from.mockImplementation((table: string) => {
    switch (table) {
      case 'portal_invitations':
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.invitation, error: null }),
            }),
          }),
          update: (payload: unknown) => {
            spies.invitationUpdate(payload);
            return { eq: async () => ({ error: null }) };
          },
        };
      case 'portal_account_students':
        return {
          upsert: async (row: unknown) => {
            spies.linkUpsert(row);
            return { error: null };
          },
        };
      case 'portal_consents':
        return {
          insert: async (rows: unknown) => {
            spies.consentInsert(rows);
            return { error: state.consentInsertError };
          },
          select: () => ({
            eq: async () => ({ data: state.consentRows, error: state.consentSelectError }),
          }),
        };
      case 'portal_accounts':
        return {
          insert: (row: unknown) => {
            spies.accountInsert(row);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: CREATED_ACCOUNT_ID, display_name: '山田 太郎' },
                  error: null,
                }),
              }),
            };
          },
          delete: () => ({
            eq: async (_column: string, value: string) => {
              spies.accountDelete(value);
              return { error: null };
            },
          }),
        };
      default:
        throw new Error(`未設定のテーブル: ${table}`);
    }
  });
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/mypage/invite/accept', {
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

/** 有効な招待（保護者向け・未受諾・期限内）。 */
function validInvitation() {
  return {
    id: INVITATION_ID,
    token: 'tok-1',
    student_id: STUDENT_ID,
    invite_type: 'guardian',
    expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    accepted_at: null,
  };
}

describe('/api/mypage/invite/accept の同意検証', () => {
  beforeEach(() => {
    mockAdmin.from.mockReset();
    Object.values(spies).forEach((s) => s.mockReset());
    state.invitation = validInvitation();
    state.consentInsertError = null;
    ctxHolder.ctx = null;
    installTableMocks();
  });

  it('agreed が無いリクエストは400で、DBに一切触らない', async () => {
    const res = await POST(makeRequest({ token: 'tok-1', relation: 'guardian' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('プライバシーポリシーと利用規約への同意が必要です');
    // 招待の検索すら行わない＝アカウント作成も紐づけも起こりえない。
    expect(mockAdmin.from).not.toHaveBeenCalled();
    expect(spies.accountInsert).not.toHaveBeenCalled();
    expect(spies.linkUpsert).not.toHaveBeenCalled();
  });

  it('agreed:false のリクエストは400で、DBに一切触らない', async () => {
    const res = await POST(
      makeRequest({
        token: 'tok-1',
        agreed: false,
        relation: 'guardian',
        display_name: '山田 太郎',
        login_id: 'taro',
        password: 'password123',
      })
    );

    expect(res.status).toBe(400);
    expect(mockAdmin.from).not.toHaveBeenCalled();
    expect(spies.accountInsert).not.toHaveBeenCalled();
    expect(spies.linkUpsert).not.toHaveBeenCalled();
  });

  it('agreed が文字列 "true" でも同意とはみなさない（真偽値のみ）', async () => {
    const res = await POST(makeRequest({ token: 'tok-1', agreed: 'true', relation: 'guardian' }));

    expect(res.status).toBe(400);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('既ログイン（紐づけモード）: agreed=true で受諾が成功し、同意ログが2行記録される', async () => {
    ctxHolder.ctx = { claims: { sub: EXISTING_ACCOUNT_ID } };

    const res = await POST(makeRequest({ token: 'tok-1', agreed: true, relation: 'guardian' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, mode: 'linked' });
    expect(spies.linkUpsert).toHaveBeenCalledTimes(1);

    const inserted = spies.consentInsert.mock.calls[0][0] as Array<Record<string, string>>;
    expect(inserted).toHaveLength(2);
    expect(inserted).toEqual(
      expect.arrayContaining([
        {
          account_id: EXISTING_ACCOUNT_ID,
          document: 'privacy_policy',
          version: LEGAL_DOCUMENTS.privacy_policy.version,
        },
        {
          account_id: EXISTING_ACCOUNT_ID,
          document: 'terms_of_service',
          version: LEGAL_DOCUMENTS.terms_of_service.version,
        },
      ])
    );
    // 同意ログを書いてから招待を消費する（順序の担保）。
    expect(spies.invitationUpdate).toHaveBeenCalledTimes(1);
  });

  it('新規作成モード: agreed=true で受諾が成功し、同意ログが2行記録される', async () => {
    const res = await POST(
      makeRequest({
        token: 'tok-1',
        agreed: true,
        relation: 'guardian',
        display_name: '山田 太郎',
        login_id: 'taro',
        password: 'password123',
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, mode: 'created' });
    expect(spies.accountInsert).toHaveBeenCalledTimes(1);

    const inserted = spies.consentInsert.mock.calls[0][0] as Array<Record<string, string>>;
    expect(inserted).toHaveLength(2);
    expect(inserted.map((r) => r.document).sort()).toEqual(['privacy_policy', 'terms_of_service']);
    expect(inserted.every((r) => r.account_id === CREATED_ACCOUNT_ID)).toBe(true);
    expect(spies.accountDelete).not.toHaveBeenCalled();
  });

  it('同意ログの記録に失敗したら500（紐づけモード・招待は消費しない）', async () => {
    ctxHolder.ctx = { claims: { sub: EXISTING_ACCOUNT_ID } };
    state.consentInsertError = { message: 'relation "portal_consents" does not exist' };

    const res = await POST(makeRequest({ token: 'tok-1', agreed: true, relation: 'guardian' }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('同意の記録に失敗しました');
    // 招待が未消費なら、保護者はもう一度同じURLでやり直せる。
    expect(spies.invitationUpdate).not.toHaveBeenCalled();
  });

  it('同意ログの記録に失敗したら500で、作りかけのアカウントを削除する（新規作成モード）', async () => {
    state.consentInsertError = { message: 'db down' };

    const res = await POST(
      makeRequest({
        token: 'tok-1',
        agreed: true,
        relation: 'guardian',
        display_name: '山田 太郎',
        login_id: 'taro',
        password: 'password123',
      })
    );

    expect(res.status).toBe(500);
    expect(spies.accountDelete).toHaveBeenCalledWith(CREATED_ACCOUNT_ID);
    expect(spies.invitationUpdate).not.toHaveBeenCalled();
  });
});

describe('hasCurrentConsent', () => {
  const CURRENT_PRIVACY = LEGAL_DOCUMENTS.privacy_policy.version;
  const CURRENT_TERMS = LEGAL_DOCUMENTS.terms_of_service.version;
  /** 「古い版」を表す番兵。現在版と一致しないことだけが意味を持つ。 */
  const OLD_VERSION = 'v0.9';

  beforeEach(() => {
    mockAdmin.from.mockReset();
    state.consentRows = [];
    state.consentSelectError = null;
    installTableMocks();
  });

  it('同意ログが1行も無ければ false', async () => {
    expect(await hasCurrentConsent(EXISTING_ACCOUNT_ID)).toBe(false);
  });

  it('片方だけ最新（もう片方が古い）なら false', async () => {
    state.consentRows = [
      { document: 'privacy_policy', version: CURRENT_PRIVACY },
      { document: 'terms_of_service', version: OLD_VERSION },
    ];
    expect(await hasCurrentConsent(EXISTING_ACCOUNT_ID)).toBe(false);
  });

  it('片方だけ最新（もう片方の行が無い）なら false', async () => {
    state.consentRows = [{ document: 'terms_of_service', version: CURRENT_TERMS }];
    expect(await hasCurrentConsent(EXISTING_ACCOUNT_ID)).toBe(false);
  });

  it('両方古ければ false', async () => {
    state.consentRows = [
      { document: 'privacy_policy', version: OLD_VERSION },
      { document: 'terms_of_service', version: OLD_VERSION },
    ];
    expect(await hasCurrentConsent(EXISTING_ACCOUNT_ID)).toBe(false);
  });

  it('両方最新なら true', async () => {
    state.consentRows = [
      { document: 'privacy_policy', version: CURRENT_PRIVACY },
      { document: 'terms_of_service', version: CURRENT_TERMS },
    ];
    expect(await hasCurrentConsent(EXISTING_ACCOUNT_ID)).toBe(true);
  });

  it('旧版の行が残っていても、最新版の行があれば true（履歴は積むだけ）', async () => {
    state.consentRows = [
      { document: 'privacy_policy', version: OLD_VERSION },
      { document: 'privacy_policy', version: CURRENT_PRIVACY },
      { document: 'terms_of_service', version: OLD_VERSION },
      { document: 'terms_of_service', version: CURRENT_TERMS },
    ];
    expect(await hasCurrentConsent(EXISTING_ACCOUNT_ID)).toBe(true);
  });

  it('取得に失敗したら false（不明なまま通さず、安全側に倒す）', async () => {
    state.consentSelectError = { message: 'db down' };
    expect(await hasCurrentConsent(EXISTING_ACCOUNT_ID)).toBe(false);
  });
});
