/**
 * ユニットテスト: src/lib/mypage/linePush.ts
 *
 * LINEプッシュは「お金がかかる」かつ「送ったら取り消せない」処理なので、
 * 次の性質が壊れていないことを固定する:
 *   1) LINE_PUSH_ENABLED が立っていなければ実送信しない（既定は dry-run）
 *   2) 宛先ゼロ・トークン未設定なら何もしない
 *   3) 500人を超える宛先は分割して送る（LINE仕様の上限）
 *   4) 本文に教室名を入れない（2026-08-07 決定。個別通知の発信元は自明なため）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/mypage/serviceClient', () => ({
  getPortalServiceClient: () => ({
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}));

import { buildPushText, sendLinePush, isLinePushEnabled } from '@/lib/mypage/linePush';

const ORIGINAL_ENV = { ...process.env };

describe('linePush: buildPushText', () => {
  it('タイトルで始まる（教室名は付けない）', () => {
    // 2026-08-07 決定: 個別通知の発信元は受け取る本人の通う教室に決まっているため
    // 名乗らない。一斉配信で他教室の内容が届く問題は宛先の絞り込みで解く。
    const text = buildPushText({ title: '報告書を公開しました', body: '本文' });
    expect(text.startsWith('報告書を公開しました')).toBe(true);
    expect(text).not.toContain('【');
  });

  it('タイトルと本文を空行で区切る', () => {
    const text = buildPushText({ title: 'お知らせ', body: '本文' });
    expect(text).toBe('お知らせ\n\n本文');
  });

  it('URLがあれば末尾に付く', () => {
    const text = buildPushText({ title: 'T', body: 'B', url: 'https://example.com/mypage' });
    expect(text.endsWith('https://example.com/mypage')).toBe(true);
  });
});

describe('linePush: sendLinePush', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.LINE_MESSAGING_ACCESS_TOKEN = 'token-abc';
    delete process.env.LINE_PUSH_ENABLED;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it('既定（LINE_PUSH_ENABLED未設定）では実送信しない', async () => {
    const r = await sendLinePush(['U1', 'U2'], '本文');
    expect(r.status).toBe('dry_run');
    expect(r.recipientCount).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('LINE_PUSH_ENABLED=true で実送信する', async () => {
    process.env.LINE_PUSH_ENABLED = 'true';
    const r = await sendLinePush(['U1', 'U2'], '本文');
    expect(r.status).toBe('sent');
    expect(r.recipientCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(['U1', 'U2']);
    expect(body.messages[0]).toEqual({ type: 'text', text: '本文' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-abc');
  });

  it('宛先ゼロなら何もしない', async () => {
    process.env.LINE_PUSH_ENABLED = 'true';
    const r = await sendLinePush([], '本文');
    expect(r.status).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('アクセストークン未設定なら送らない', async () => {
    process.env.LINE_PUSH_ENABLED = 'true';
    delete process.env.LINE_MESSAGING_ACCESS_TOKEN;
    const r = await sendLinePush(['U1'], '本文');
    expect(r.status).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('宛先の重複は除いて数える（二重課金を避ける）', async () => {
    process.env.LINE_PUSH_ENABLED = 'true';
    const r = await sendLinePush(['U1', 'U1', 'U2'], '本文');
    expect(r.recipientCount).toBe(2);
  });

  it('500人を超える宛先は分割して送る（LINEのmulticast上限）', async () => {
    process.env.LINE_PUSH_ENABLED = 'true';
    const many = Array.from({ length: 501 }, (_, i) => `U${i}`);
    const r = await sendLinePush(many, '本文');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.recipientCount).toBe(501);
  });

  it('LINEがエラーを返したら error として返す（throwしない）', async () => {
    process.env.LINE_PUSH_ENABLED = 'true';
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad request' });
    const r = await sendLinePush(['U1'], '本文');
    expect(r.status).toBe('error');
    expect(r.detail).toContain('400');
  });

  it('isLinePushEnabled は true 文字列のときだけ真', () => {
    expect(isLinePushEnabled()).toBe(false);
    process.env.LINE_PUSH_ENABLED = 'yes';
    expect(isLinePushEnabled()).toBe(false);
    process.env.LINE_PUSH_ENABLED = 'true';
    expect(isLinePushEnabled()).toBe(true);
  });
});
