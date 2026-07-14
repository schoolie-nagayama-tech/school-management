import { describe, it, expect, vi } from 'vitest';

// notify.ts は 'server-only' を import するため、node のテスト環境では空モジュールに差し替える。
vi.mock('server-only', () => ({}));

import {
  dispatchNotification,
  inAppChannel,
  type NotifyChannel,
  type NotifyEvent,
} from '@/lib/mypage/notify';

/**
 * 通知ディスパッチャのユニット（チャネル差し替えのファンアウト検証）。
 * 実DB/実送信はモックの注入で回避する。
 */
describe('notify: dispatchNotification', () => {
  const event: NotifyEvent = {
    kind: 'chat_new_message',
    studentId: 's1',
    title: 'タイトル',
    body: '本文',
  };

  it('全チャネルへファンアウトし結果を集約する', async () => {
    const calls: string[] = [];
    const chA: NotifyChannel = {
      name: 'a',
      send: vi.fn(async () => {
        calls.push('a');
        return { channel: 'a', delivered: 1, skipped: false };
      }),
    };
    const chB: NotifyChannel = {
      name: 'b',
      send: vi.fn(async () => {
        calls.push('b');
        return { channel: 'b', delivered: 0, skipped: true };
      }),
    };
    const results = await dispatchNotification(event, {
      channels: [chA, chB],
      emailResolver: async () => [],
    });
    expect(calls).toEqual(['a', 'b']);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.channel === 'a')?.delivered).toBe(1);
    expect(results.find((r) => r.channel === 'b')?.skipped).toBe(true);
  });

  it('email チャネルが無ければ宛先リゾルバは呼ばれない', async () => {
    const resolver = vi.fn(async () => ['x@example.com']);
    await dispatchNotification(event, { channels: [inAppChannel], emailResolver: resolver });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('email チャネルには解決した宛先が渡る', async () => {
    let received: string[] = [];
    const email: NotifyChannel = {
      name: 'email',
      send: vi.fn(async (_e, recipients) => {
        received = recipients;
        return { channel: 'email', delivered: recipients.length, skipped: recipients.length === 0 };
      }),
    };
    await dispatchNotification(event, {
      channels: [email],
      emailResolver: async () => ['a@example.com', 'b@example.com'],
    });
    expect(received).toEqual(['a@example.com', 'b@example.com']);
  });

  it('チャネルが投げても他チャネルの結果は返る（throwしない）', async () => {
    const bad: NotifyChannel = {
      name: 'bad',
      send: async () => {
        throw new Error('boom');
      },
    };
    const good: NotifyChannel = {
      name: 'good',
      send: async () => ({ channel: 'good', delivered: 1, skipped: false }),
    };
    const results = await dispatchNotification(event, {
      channels: [bad, good],
      emailResolver: async () => [],
    });
    expect(results.find((r) => r.channel === 'bad')?.error).toContain('boom');
    expect(results.find((r) => r.channel === 'good')?.delivered).toBe(1);
  });

  it('in-app チャネルは副作用なしで skipped=false', async () => {
    const r = await inAppChannel.send(event, []);
    expect(r).toEqual({ channel: 'in-app', delivered: 0, skipped: false });
  });
});
