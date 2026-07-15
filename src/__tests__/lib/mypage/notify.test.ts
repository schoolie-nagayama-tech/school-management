import { describe, it, expect, vi, beforeEach } from 'vitest';

// notify.ts は 'server-only' を import するため、node のテスト環境では空モジュールに差し替える。
vi.mock('server-only', () => ({}));

/**
 * service_role クライアントの fake。
 * defaultEmailResolver は students（ダミー判定）→ form_responses（宛先収集）の
 * 2クエリを投げるので、テーブル名で応答を出し分ける。
 * vi.mock の factory は巻き上げられるため、状態は vi.hoisted で用意する。
 */
const state = vi.hoisted(() => ({
  student: null as { is_test?: boolean; schools?: { is_demo?: boolean } | null } | null,
  studentError: null as { message: string } | null,
  formResponses: [] as { email: string | null; created_at: string }[],
}));

vi.mock('@/lib/mypage/serviceClient', () => ({
  getPortalServiceClient: () => ({
    from: (table: string) => {
      if (table === 'students') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.student, error: state.studentError }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            not: () => ({
              order: () => ({
                limit: async () => ({ data: state.formResponses, error: null }),
              }),
            }),
          }),
        }),
      };
    },
  }),
}));

import {
  dispatchNotification,
  defaultEmailResolver,
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

/**
 * ダミーデータ（研修用テスト生徒 / デモ教室）から実在の保護者にメールが飛ぶ事故を、
 * 宛先解決の1箇所で塞げているかの検証。デモ体験で操作した結果が外に出ない保証。
 */
describe('notify: defaultEmailResolver のダミーデータガード', () => {
  const event: NotifyEvent = {
    kind: 'chat_new_message',
    studentId: 's1',
    title: 'タイトル',
    body: '本文',
  };

  beforeEach(() => {
    state.student = { is_test: false, schools: { is_demo: false } };
    state.studentError = null;
    state.formResponses = [{ email: 'parent@example.com', created_at: '2026-07-01' }];
  });

  it('通常の生徒では宛先を解決する（ガードが過剰に効かない）', async () => {
    expect(await defaultEmailResolver(event)).toEqual(['parent@example.com']);
  });

  it('研修用テスト生徒（is_test）では宛先を返さない', async () => {
    state.student = { is_test: true, schools: { is_demo: false } };
    expect(await defaultEmailResolver(event)).toEqual([]);
  });

  it('デモ教室（is_demo）の生徒では宛先を返さない', async () => {
    state.student = { is_test: false, schools: { is_demo: true } };
    expect(await defaultEmailResolver(event)).toEqual([]);
  });

  it('ダミー判定が失敗したら安全側に倒して宛先を返さない', async () => {
    // 「送れないダミー」より「送ってはいけない相手に送る」方が害が大きい。
    state.studentError = { message: 'boom' };
    expect(await defaultEmailResolver(event)).toEqual([]);
  });

  it('生徒が見つからない場合も宛先を返さない', async () => {
    state.student = null;
    expect(await defaultEmailResolver(event)).toEqual([]);
  });

  it('toEmails の明示指定はガードより優先される（従来どおり）', async () => {
    // 明示指定は呼び出し側が宛先を確定させている経路なので短絡させる（既存挙動の固定）。
    state.student = { is_test: true, schools: { is_demo: true } };
    expect(await defaultEmailResolver({ ...event, toEmails: ['x@example.com'] })).toEqual([
      'x@example.com',
    ]);
  });
});
