import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';

/**
 * cron エンドポイントの認証ガードのテスト。
 *
 * 最重要は「CRON_SECRET 未設定なら必ず拒否する」ケース。
 * 以前は `if (CRON_SECRET && authHeader !== ...)` と書かれており、環境変数が未設定だと
 * 条件全体が false になって認証が素通りしていた（フェイルオープン）。
 * withdraw-expired-students は生徒ステータスを一括で退塾に変える破壊的処理なので、
 * この回帰は必ず検知できるようにしておく。
 */

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function makeRequest(authorization?: string): NextRequest {
  const headers = new Headers();
  if (authorization !== undefined) {
    headers.set('authorization', authorization);
  }
  return new NextRequest('http://localhost:3000/api/cron/withdraw-expired-students', { headers });
}

describe('requireCronAuth', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret';
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = ORIGINAL_SECRET;
    }
  });

  it('CRON_SECRET が未設定なら、正しそうなヘッダーが来ても拒否する（フェイルクローズド）', async () => {
    delete process.env.CRON_SECRET;

    const res = requireCronAuth(makeRequest('Bearer test-cron-secret'));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('CRON_SECRET が空文字でも拒否する', async () => {
    process.env.CRON_SECRET = '';

    const res = requireCronAuth(makeRequest('Bearer '));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('正しい Bearer トークンなら通す', () => {
    const res = requireCronAuth(makeRequest('Bearer test-cron-secret'));

    expect(res).toBeNull();
  });

  it('トークンが違えば拒否する', () => {
    const res = requireCronAuth(makeRequest('Bearer wrong-secret-xx'));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('authorization ヘッダーが無ければ拒否する', () => {
    const res = requireCronAuth(makeRequest());

    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('長さの違うトークンでも例外を投げずに拒否する（定数時間比較の分岐）', () => {
    const res = requireCronAuth(makeRequest('Bearer short'));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('Bearer 接頭辞が無ければ拒否する', () => {
    const res = requireCronAuth(makeRequest('test-cron-secret'));

    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });
});
