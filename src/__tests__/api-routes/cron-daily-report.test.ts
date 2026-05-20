/**
 * APIルートテスト: /api/cron/daily-material-report (GET)
 * Vercel Cron認証 + 土日スキップのテスト
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createMockSupabaseAdmin, createMockChain } from './helpers';

const mockAdmin = createMockSupabaseAdmin();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAdmin),
}));

vi.mock('@/lib/slack', () => ({
  notifyDailyReport: vi.fn().mockResolvedValue(undefined),
}));

function makeRequest(authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader) headers['authorization'] = authHeader;
  return new NextRequest('http://localhost:3000/api/cron/daily-material-report', { headers });
}

describe('GET /api/cron/daily-material-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  });

  it('CRON_SECRET不一致で401を返す', async () => {
    const { GET } = await import('@/app/api/cron/daily-material-report/route');
    const res = await GET(makeRequest('Bearer wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('Authorizationヘッダなしで401を返す', async () => {
    const { GET } = await import('@/app/api/cron/daily-material-report/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('正しいCRON_SECRETで認証通過する', async () => {
    // 平日に固定
    const weekdayDate = new Date('2026-05-18T04:00:00Z'); // 月曜 13:00 JST
    vi.setSystemTime(weekdayDate);

    // DB呼び出しはすべて空データ
    mockAdmin.from.mockImplementation(() => createMockChain([]) as never);

    const { GET } = await import('@/app/api/cron/daily-material-report/route');
    const res = await GET(makeRequest('Bearer test-cron-secret'));

    // 401/403ではないこと（認証通過）
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);

    vi.useRealTimers();
  });

  it('土曜日はスキップされる', async () => {
    const saturday = new Date('2026-05-23T04:00:00Z'); // 土曜 13:00 JST
    vi.setSystemTime(saturday);

    const { GET } = await import('@/app/api/cron/daily-material-report/route');
    const res = await GET(makeRequest('Bearer test-cron-secret'));
    const body = await res.json();

    expect(body.skipped).toBe(true);
    expect(body.reason).toBe('weekend');

    vi.useRealTimers();
  });

  it('日曜日はスキップされる', async () => {
    const sunday = new Date('2026-05-24T04:00:00Z'); // 日曜 13:00 JST
    vi.setSystemTime(sunday);

    const { GET } = await import('@/app/api/cron/daily-material-report/route');
    const res = await GET(makeRequest('Bearer test-cron-secret'));
    const body = await res.json();

    expect(body.skipped).toBe(true);
    expect(body.reason).toBe('weekend');

    vi.useRealTimers();
  });
});
