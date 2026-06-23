import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit } from '@/lib/utils/rateLimit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    // タイムスタンプをリセットするため、十分な間隔をあける
    vi.useFakeTimers();
  });

  it('制限内のリクエストは許可される', () => {
    const result = checkRateLimit('192.168.1.1', '/api/test', { limit: 5, windowSeconds: 60 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('連続リクエストでremainingが減少する', () => {
    const ip = '10.0.0.1';
    const path = '/api/decrement-test';
    const opts = { limit: 3, windowSeconds: 60 };

    const r1 = checkRateLimit(ip, path, opts);
    expect(r1.remaining).toBe(2);

    const r2 = checkRateLimit(ip, path, opts);
    expect(r2.remaining).toBe(1);

    const r3 = checkRateLimit(ip, path, opts);
    expect(r3.remaining).toBe(0);
    expect(r3.allowed).toBe(true); // まだ制限内（ちょうど3回目）
  });

  it('制限を超えるとブロックされる', () => {
    const ip = '10.0.0.2';
    const path = '/api/block-test';
    const opts = { limit: 2, windowSeconds: 60 };

    checkRateLimit(ip, path, opts);
    checkRateLimit(ip, path, opts);
    const r3 = checkRateLimit(ip, path, opts);

    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
  });

  it('異なるIPは独立してカウントされる', () => {
    const path = '/api/ip-test';
    const opts = { limit: 1, windowSeconds: 60 };

    const r1 = checkRateLimit('1.1.1.1', path, opts);
    expect(r1.allowed).toBe(true);

    const r2 = checkRateLimit('2.2.2.2', path, opts);
    expect(r2.allowed).toBe(true);
  });

  it('異なるパスは独立してカウントされる', () => {
    const ip = '10.0.0.3';
    const opts = { limit: 1, windowSeconds: 60 };

    const r1 = checkRateLimit(ip, '/api/path-a', opts);
    expect(r1.allowed).toBe(true);

    const r2 = checkRateLimit(ip, '/api/path-b', opts);
    expect(r2.allowed).toBe(true);
  });

  it('ウィンドウ経過後はリセットされる', () => {
    const ip = '10.0.0.4';
    const path = '/api/reset-test';
    const opts = { limit: 1, windowSeconds: 10 };

    checkRateLimit(ip, path, opts);
    const blocked = checkRateLimit(ip, path, opts);
    expect(blocked.allowed).toBe(false);

    // 10秒後
    vi.advanceTimersByTime(11_000);

    const after = checkRateLimit(ip, path, opts);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(0); // limit=1, count=1
  });

  it('resetAtが正しく設定される', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const result = checkRateLimit('10.0.0.5', '/api/reset-at-test', {
      limit: 10,
      windowSeconds: 60,
    });
    expect(result.resetAt).toBe(new Date('2026-01-01T00:01:00Z').getTime());
  });
});
