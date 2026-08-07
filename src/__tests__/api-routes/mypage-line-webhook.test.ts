/**
 * APIルートテスト: /api/mypage/line/webhook (POST)
 *
 * この受け口は公開エンドポイントで誰でもPOSTできる。次を固定する:
 *   1) 署名が無い/不正なリクエストは 401 で、DBに一切触らない
 *      （他人のユーザーIDで unfollow を偽装し通知を止める改ざんを防ぐ）
 *   2) 正当な follow / unfollow で line_followed が更新される
 *   3) 接続確認（events 空）に 200 を返す
 *   4) 処理が失敗しても 200 を返す（LINEは2xx以外が続くとwebhookを自動停止するため）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';

vi.mock('server-only', () => ({}));

const mockAdmin = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/mypage/serviceClient', () => ({
  getPortalServiceClient: () => mockAdmin,
}));

import { POST } from '@/app/api/mypage/line/webhook/route';

const SECRET = 'test-channel-secret';

/** 本文から正しい署名を作る（LINEと同じ計算）。 */
function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('base64');
}

/** webhook リクエストを組み立てる。signature 省略時は正しい署名を付ける。 */
function makeRequest(body: unknown, signature?: string | null): NextRequest {
  const raw = JSON.stringify(body);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const sig = signature === undefined ? sign(raw) : signature;
  if (sig !== null) headers.set('x-line-signature', sig);

  return new NextRequest('http://localhost:3000/api/mypage/line/webhook', {
    method: 'POST',
    headers,
    body: raw,
  });
}

/** portal_accounts.update(...).eq(...) を捕まえるスパイを仕込む。 */
function mockUpdate(error: { message: string } | null = null) {
  const eqSpy = vi.fn().mockResolvedValue({ error });
  const updateSpy = vi.fn(() => ({ eq: eqSpy }));
  mockAdmin.from.mockImplementation((table: string) => {
    if (table === 'portal_accounts') return { update: updateSpy };
    throw new Error(`未設定のテーブル: ${table}`);
  });
  return { updateSpy, eqSpy };
}

describe('/api/mypage/line/webhook', () => {
  beforeEach(() => {
    mockAdmin.from.mockReset();
    process.env.LINE_MESSAGING_CHANNEL_SECRET = SECRET;
  });

  it('署名が無いリクエストは401でDBに触らない', async () => {
    mockUpdate();
    const res = await POST(makeRequest({ events: [] }, null));

    expect(res.status).toBe(401);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('署名が不正なリクエストは401でDBに触らない', async () => {
    mockUpdate();
    const res = await POST(makeRequest({ events: [] }, 'ZmFrZS1zaWduYXR1cmU='));

    expect(res.status).toBe(401);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('本文を改ざんすると署名が一致せず401（生ボディで検証している証拠）', async () => {
    mockUpdate();
    const original = JSON.stringify({ events: [] });
    const tampered = JSON.stringify({ events: [{ type: 'unfollow', source: { userId: 'U-x' } }] });

    const req = new NextRequest('http://localhost:3000/api/mypage/line/webhook', {
      method: 'POST',
      headers: new Headers({ 'x-line-signature': sign(original) }),
      body: tampered,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('チャネルシークレット未設定なら検証不能として401', async () => {
    delete process.env.LINE_MESSAGING_CHANNEL_SECRET;
    mockUpdate();
    const res = await POST(makeRequest({ events: [] }));

    expect(res.status).toBe(401);
  });

  it('接続確認（events空）には200を返す', async () => {
    mockUpdate();
    const res = await POST(makeRequest({ events: [] }));

    expect(res.status).toBe(200);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('follow で line_followed=true に更新する', async () => {
    const { updateSpy, eqSpy } = mockUpdate();
    const res = await POST(
      makeRequest({ events: [{ type: 'follow', source: { userId: 'U-abc' } }] })
    );

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ line_followed: true, line_follow_updated_at: expect.any(String) })
    );
    expect(eqSpy).toHaveBeenCalledWith('line_user_id', 'U-abc');
  });

  it('unfollow で line_followed=false に更新する', async () => {
    const { updateSpy, eqSpy } = mockUpdate();
    const res = await POST(
      makeRequest({ events: [{ type: 'unfollow', source: { userId: 'U-abc' } }] })
    );

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ line_followed: false }));
    expect(eqSpy).toHaveBeenCalledWith('line_user_id', 'U-abc');
  });

  it('message など対象外のイベントは無視する', async () => {
    const { updateSpy } = mockUpdate();
    const res = await POST(
      makeRequest({
        events: [{ type: 'message', source: { userId: 'U-abc' }, message: { text: 'hi' } }],
      })
    );

    expect(res.status).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('userId が無いイベントは無視する', async () => {
    const { updateSpy } = mockUpdate();
    const res = await POST(makeRequest({ events: [{ type: 'follow', source: {} }] }));

    expect(res.status).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('複数イベントをまとめて処理する', async () => {
    const { updateSpy } = mockUpdate();
    const res = await POST(
      makeRequest({
        events: [
          { type: 'follow', source: { userId: 'U-1' } },
          { type: 'unfollow', source: { userId: 'U-2' } },
        ],
      })
    );

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(2);
  });

  it('DB更新に失敗しても200を返す（webhookを止めさせない）', async () => {
    mockUpdate({ message: 'db down' });
    const res = await POST(
      makeRequest({ events: [{ type: 'unfollow', source: { userId: 'U-abc' } }] })
    );

    expect(res.status).toBe(200);
  });
});
