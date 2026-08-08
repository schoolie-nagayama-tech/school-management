/**
 * APIルートテスト: /api/admin/portal-accounts (GET / DELETE)
 *
 * 受諾済みポータルアカウントの一覧・紐づけ解除・アカウント削除を検証する。
 * このエンドポイントは運用者が「誤紐づけ」「アカウント作り直し」を自己解決する手段なので、
 * 次が壊れていないことを固定する:
 *   1) requireAdmin で閉じている（拒否時はDBに触れない）
 *   2) DELETE {account_id, student_id} は紐づけ1行だけ消し、アカウントは消さない
 *   3) DELETE {account_id} はアカウントを消す（cascade で紐づけ・同意ログも消える）
 *   4) 不正/欠落の account_id は 400
 *   5) GET は紐づけ生徒配列つきで返し、line_user_id の「値」は漏らさない
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/api-auth', () => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
}));

// service role クライアントを差し替える（実DB・実鍵に触らない）。
const mockAdmin = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/mypage/serviceClient', () => ({
  getPortalServiceClient: () => mockAdmin,
}));

import { GET, DELETE } from '@/app/api/admin/portal-accounts/route';
import { requireAdmin } from '@/lib/api-auth';

const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111';
const STUDENT_ID = '22222222-2222-2222-2222-222222222222';

function makeRequest(body?: unknown) {
  return new NextRequest('http://localhost:3000/api/admin/portal-accounts', {
    method: body === undefined ? 'GET' : 'DELETE',
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

describe('GET /api/admin/portal-accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(null);
  });

  it('requireAdmin が拒否したらそのレスポンスを返し、DBに触らない', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(
      NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 })
    );

    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('紐づけ生徒配列つきで返し、line_user_id の値は含めない', async () => {
    // 1回目: portal_accounts の select→order→order（await で解決）
    // 2回目: portal_account_students の select→in（await で解決）
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'portal_accounts') {
        return {
          select: () => ({
            order: () => ({
              order: () =>
                Promise.resolve({
                  data: [
                    {
                      id: ACCOUNT_ID,
                      display_name: '山田 太郎（父）',
                      login_id: null,
                      line_user_id: 'U-secret-line-id',
                      last_login_at: '2026-08-01T00:00:00Z',
                      created_at: '2026-07-01T00:00:00Z',
                    },
                  ],
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === 'portal_account_students') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [
                  {
                    account_id: ACCOUNT_ID,
                    student_id: STUDENT_ID,
                    relation: 'father',
                    students: { last_name: '山田', first_name: '花子' },
                  },
                ],
                error: null,
              }),
          }),
        };
      }
      throw new Error(`未設定のテーブル: ${table}`);
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.accounts).toHaveLength(1);
    const acc = json.accounts[0];
    expect(acc).toMatchObject({
      id: ACCOUNT_ID,
      display_name: '山田 太郎（父）',
      login_id: null,
      has_line: true,
      last_login_at: '2026-08-01T00:00:00Z',
    });
    // 紐づけ生徒が student_name（姓 名）つきで入る。
    expect(acc.students).toEqual([
      { student_id: STUDENT_ID, student_name: '山田 花子', relation: 'father' },
    ]);
    // ★ line_user_id の値そのものはレスポンス JSON のどこにも出ないこと。
    expect(JSON.stringify(json)).not.toContain('U-secret-line-id');
    expect('line_user_id' in acc).toBe(false);
  });

  it('アカウントが0件なら紐づけクエリを打たずに空配列を返す', async () => {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'portal_accounts') {
        return {
          select: () => ({
            order: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      throw new Error(`紐づけクエリは打たれないはず: ${table}`);
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).accounts).toEqual([]);
    // portal_account_students は呼ばれない。
    expect(mockAdmin.from).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/admin/portal-accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue(null);
  });

  it('requireAdmin が拒否したらそのレスポンスを返し、DBに触らない', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(
      NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    );

    const res = await DELETE(makeRequest({ account_id: ACCOUNT_ID }));
    expect(res.status).toBe(401);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('{account_id, student_id} は紐づけ1行だけ削除し、アカウントは削除しない', async () => {
    const eqStudent = vi.fn().mockResolvedValue({ error: null });
    const eqAccount = vi.fn().mockReturnValue({ eq: eqStudent });
    const del = vi.fn().mockReturnValue({ eq: eqAccount });
    mockAdmin.from.mockImplementation((table: string) => {
      expect(table).toBe('portal_account_students'); // アカウント本体は触らない
      return { delete: del };
    });

    const res = await DELETE(makeRequest({ account_id: ACCOUNT_ID, student_id: STUDENT_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: 'unlinked' });

    // portal_account_students に対し account_id と student_id の両方で絞って delete。
    expect(mockAdmin.from).toHaveBeenCalledWith('portal_account_students');
    expect(mockAdmin.from).not.toHaveBeenCalledWith('portal_accounts');
    expect(eqAccount).toHaveBeenCalledWith('account_id', ACCOUNT_ID);
    expect(eqStudent).toHaveBeenCalledWith('student_id', STUDENT_ID);
  });

  it('{account_id} のみなら portal_accounts を削除する', async () => {
    const eqId = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn().mockReturnValue({ eq: eqId });
    mockAdmin.from.mockImplementation((table: string) => {
      expect(table).toBe('portal_accounts');
      return { delete: del };
    });

    const res = await DELETE(makeRequest({ account_id: ACCOUNT_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: 'account_deleted' });

    expect(mockAdmin.from).toHaveBeenCalledWith('portal_accounts');
    expect(eqId).toHaveBeenCalledWith('id', ACCOUNT_ID);
  });

  it('対象が存在しなくても 200（冪等）', async () => {
    // Supabase の delete は該当0件でも error=null を返す。ルートはそれをそのまま 200 に。
    const del = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
    mockAdmin.from.mockImplementation(() => ({ delete: del }));

    const res = await DELETE(makeRequest({ account_id: ACCOUNT_ID }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('account_id が欠落なら 400（DBに触らない）', async () => {
    const res = await DELETE(makeRequest({ student_id: STUDENT_ID }));
    expect(res.status).toBe(400);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('account_id が uuid でなければ 400', async () => {
    const res = await DELETE(makeRequest({ account_id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('student_id を渡したが uuid でなければ 400', async () => {
    const res = await DELETE(makeRequest({ account_id: ACCOUNT_ID, student_id: 'bad' }));
    expect(res.status).toBe(400);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('JSON でない body は 400', async () => {
    const res = await DELETE(makeRequest('not json'));
    expect(res.status).toBe(400);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });
});
