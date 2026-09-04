import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  linkedAccounts: [] as {
    portal_accounts: { line_user_id: string | null; line_followed?: boolean } | null;
  }[],
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
      if (table === 'portal_account_students') {
        // defaultLineResolver は select(...).eq(...) で終わる（await される）。
        return {
          select: () => ({
            eq: async () => ({ data: state.linkedAccounts, error: null }),
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
  defaultLineResolver,
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

  it('line チャネルが無ければLINE宛先リゾルバは呼ばれない', async () => {
    const lineResolver = vi.fn(async () => ['U1']);
    await dispatchNotification(event, {
      channels: [inAppChannel],
      emailResolver: async () => [],
      lineResolver,
    });
    expect(lineResolver).not.toHaveBeenCalled();
  });

  it('宛先はチャネルごとに渡し分ける（emailにメール／lineにLINE ID）', async () => {
    let toEmail: string[] = [];
    let toLine: string[] = [];
    const email: NotifyChannel = {
      name: 'email',
      send: async (_e, r) => {
        toEmail = r;
        return { channel: 'email', delivered: r.length, skipped: false };
      },
    };
    const line: NotifyChannel = {
      name: 'line',
      send: async (_e, r) => {
        toLine = r;
        return { channel: 'line', delivered: r.length, skipped: false };
      },
    };

    await dispatchNotification(event, {
      channels: [email, line],
      emailResolver: async () => ['a@example.com'],
      lineResolver: async () => ['U1', 'U2'],
    });

    // メールアドレスがLINEチャネルに漏れない・その逆も起きない。
    expect(toEmail).toEqual(['a@example.com']);
    expect(toLine).toEqual(['U1', 'U2']);
  });
});

/**
 * LINE宛先解決のダミーデータガード。
 * デモ操作から実在の保護者にLINEが飛ぶ事故はメール以上に取り返しがつかない
 * （既読が付き、送信後の削除もできない）ので、メールと同じ強度で塞げているか固定する。
 */
describe('notify: defaultLineResolver のダミーデータガード', () => {
  const event: NotifyEvent = {
    kind: 'report_published',
    audience: 'guardian',
    studentId: 's1',
    title: 'タイトル',
    body: '本文',
  };

  beforeEach(() => {
    state.student = { is_test: false, schools: { is_demo: false } };
    state.studentError = null;
    state.linkedAccounts = [
      { portal_accounts: { line_user_id: 'U-a' } },
      { portal_accounts: { line_user_id: 'U-b' } },
    ];
  });

  it('通常の生徒では紐づくLINE IDを返す', async () => {
    expect(await defaultLineResolver(event)).toEqual(['U-a', 'U-b']);
  });

  it('audience 未指定（＝スタッフ宛の既定）ではLINE宛先を返さない', async () => {
    // 保護者の送信に対するスタッフ宛通知が、保護者自身にLINEで返る誤配信を防ぐ。
    const { audience: _omit, ...noAudience } = event;
    expect(await defaultLineResolver(noAudience as NotifyEvent)).toEqual([]);
  });

  it('audience=staff では明示的にLINE宛先を返さない', async () => {
    expect(await defaultLineResolver({ ...event, audience: 'staff' })).toEqual([]);
  });

  it('研修用テスト生徒（is_test）では宛先を返さない', async () => {
    state.student = { is_test: true, schools: { is_demo: false } };
    expect(await defaultLineResolver(event)).toEqual([]);
  });

  it('デモ教室（is_demo）の生徒では宛先を返さない', async () => {
    state.student = { is_test: false, schools: { is_demo: true } };
    expect(await defaultLineResolver(event)).toEqual([]);
  });

  it('ダミー判定が失敗したら安全側に倒して宛先を返さない', async () => {
    state.studentError = { message: 'boom' };
    expect(await defaultLineResolver(event)).toEqual([]);
  });

  it('LINE未連携のアカウントは宛先に含めない', async () => {
    state.linkedAccounts = [
      { portal_accounts: { line_user_id: null } },
      { portal_accounts: { line_user_id: 'U-c' } },
    ];
    expect(await defaultLineResolver(event)).toEqual(['U-c']);
  });

  it('友だち解除・ブロックされた相手は宛先から外す（webhookが false にする）', async () => {
    state.linkedAccounts = [
      { portal_accounts: { line_user_id: 'U-blocked', line_followed: false } },
      { portal_accounts: { line_user_id: 'U-active', line_followed: true } },
    ];
    expect(await defaultLineResolver(event)).toEqual(['U-active']);
  });

  it('友だち状態が不明（カラム未取得）なら送る側に倒す', async () => {
    // 既存データ・古いクエリとの互換。届かなければLINE側で失敗するだけで害は小さい。
    state.linkedAccounts = [{ portal_accounts: { line_user_id: 'U-unknown' } }];
    expect(await defaultLineResolver(event)).toEqual(['U-unknown']);
  });

  it('studentId が無ければ宛先を返さない', async () => {
    expect(await defaultLineResolver({ ...event, studentId: undefined })).toEqual([]);
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

/**
 * デモ通知試用の許可リスト（NOTIFY_DEMO_LINE_ALLOWLIST / NOTIFY_DEMO_EMAIL_ALLOWLIST）。
 * ダミーデータガードの唯一の例外なので、以下を厳密に固定する:
 *   1) env 未設定なら従来どおり全ブロック（既定の安全性が変わらない）
 *   2) 設定時もリスト掲載の宛先しか返らない（リスト外の実在宛先は落ちる）
 *   3) 実在生徒（非ダミー）の経路には一切影響しない
 */
describe('notify: デモ通知試用の許可リスト', () => {
  const lineEvent: NotifyEvent = {
    kind: 'report_published',
    audience: 'guardian',
    studentId: 's1',
    title: 'タイトル',
    body: '本文',
  };
  const emailEvent: NotifyEvent = {
    kind: 'chat_new_message',
    studentId: 's1',
    title: 'タイトル',
    body: '本文',
  };

  beforeEach(() => {
    // ダミー生徒（デモ教室）を既定にする。
    state.student = { is_test: false, schools: { is_demo: true } };
    state.studentError = null;
    state.linkedAccounts = [
      { portal_accounts: { line_user_id: 'U-staff' } },
      { portal_accounts: { line_user_id: 'U-real-parent' } },
    ];
    state.formResponses = [
      { email: 'staff@example.com', created_at: '2026-07-02' },
      { email: 'parent@example.com', created_at: '2026-07-01' },
    ];
  });

  afterEach(() => {
    // env はテストプロセス全体で共有されるので必ず掃除する。
    delete process.env.NOTIFY_DEMO_LINE_ALLOWLIST;
    delete process.env.NOTIFY_DEMO_EMAIL_ALLOWLIST;
  });

  it('LINE: env 未設定ならダミー生徒は従来どおり全ブロック', async () => {
    expect(await defaultLineResolver(lineEvent)).toEqual([]);
  });

  it('LINE: 許可リスト掲載の userId だけが宛先に残る', async () => {
    process.env.NOTIFY_DEMO_LINE_ALLOWLIST = 'U-staff';
    expect(await defaultLineResolver(lineEvent)).toEqual(['U-staff']);
  });

  it('LINE: リスト外しか紐づいていなければ空（実在宛先には流れない）', async () => {
    process.env.NOTIFY_DEMO_LINE_ALLOWLIST = 'U-someone-else';
    expect(await defaultLineResolver(lineEvent)).toEqual([]);
  });

  it('LINE: 実在生徒（非ダミー）の宛先解決は許可リストの影響を受けない', async () => {
    state.student = { is_test: false, schools: { is_demo: false } };
    process.env.NOTIFY_DEMO_LINE_ALLOWLIST = 'U-staff';
    expect(await defaultLineResolver(lineEvent)).toEqual(['U-staff', 'U-real-parent']);
  });

  it('メール: env 未設定ならダミー生徒は従来どおり全ブロック', async () => {
    expect(await defaultEmailResolver(emailEvent)).toEqual([]);
  });

  it('メール: 許可リスト掲載のアドレスだけが残る（大文字小文字は無視）', async () => {
    process.env.NOTIFY_DEMO_EMAIL_ALLOWLIST = 'STAFF@example.com';
    expect(await defaultEmailResolver(emailEvent)).toEqual(['staff@example.com']);
  });

  it('メール: 空白まじりのカンマ区切りをパースできる', async () => {
    process.env.NOTIFY_DEMO_EMAIL_ALLOWLIST = ' staff@example.com , other@example.com ';
    expect(await defaultEmailResolver(emailEvent)).toEqual(['staff@example.com']);
  });

  it('メール: 実在生徒（非ダミー）の宛先解決は許可リストの影響を受けない', async () => {
    state.student = { is_test: false, schools: { is_demo: false } };
    process.env.NOTIFY_DEMO_EMAIL_ALLOWLIST = 'staff@example.com';
    expect(await defaultEmailResolver(emailEvent)).toEqual([
      'staff@example.com',
      'parent@example.com',
    ]);
  });

  it('ダミー判定が失敗してもリスト外には漏れない（安全側の下限を固定）', async () => {
    // isDummyStudent のエラーは dummy=true 扱い。許可リストが設定されていれば
    // リスト掲載分（＝自社スタッフ）だけは届くが、リスト外の実在宛先には決して
    // 流れない。ここで固定したいのはその下限。
    state.studentError = { message: 'boom' };
    process.env.NOTIFY_DEMO_LINE_ALLOWLIST = 'U-staff';
    expect(await defaultLineResolver(lineEvent)).toEqual(['U-staff']);
  });
});
