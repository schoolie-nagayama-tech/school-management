import { describe, it, expect } from 'vitest';

describe('API認証ガード', () => {
  const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

  it('未認証で /api/admin/users にアクセスすると 401 が返る', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/users`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('認証が必要です');
  });

  it('未認証で /api/admin/users/create にアクセスすると 401 が返る', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/users/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('未認証で /api/admin/users/fake-id にアクセスすると 401 が返る', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/users/fake-id`);
    expect(res.status).toBe(401);
  });

  it('未認証で /api/seasonal-shift/notify にアクセスすると 401 が返る', async () => {
    const res = await fetch(`${BASE_URL}/api/seasonal-shift/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('エラーレスポンスに details フィールドが含まれない', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/users`);
    const body = await res.json();
    expect(body).not.toHaveProperty('details');
  });
});
