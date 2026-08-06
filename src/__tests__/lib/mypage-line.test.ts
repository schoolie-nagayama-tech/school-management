/**
 * ユニットテスト: src/lib/mypage/line.ts
 *
 * 認可URLの組み立てを固定する。ここを間違えると
 *   - scope に openid が無い → id_token が返らずログイン不能
 *   - bot_prompt が付かない → 友だち追加が促されず push が届かない
 * といった形で、実機で初めて気づく壊れ方をするため。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { buildAuthorizeUrl, buildRedirectUri, isLineLoginConfigured } from '@/lib/mypage/line';

const ORIGINAL_ENV = { ...process.env };

describe('mypage/line', () => {
  beforeEach(() => {
    process.env.LINE_LOGIN_CHANNEL_ID = 'channel-123';
    process.env.LINE_LOGIN_CHANNEL_SECRET = 'secret-abc';
    delete process.env.LINE_LOGIN_REDIRECT_URI;
    delete process.env.LINE_LOGIN_BOT_PROMPT;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('buildAuthorizeUrl', () => {
    it('必要なパラメータを揃えて認可URLを組み立てる', () => {
      const url = new URL(
        buildAuthorizeUrl({
          redirectUri: 'https://www.school-ie.com/api/mypage/line/callback',
          state: 'st',
          nonce: 'no',
        })
      );

      expect(url.origin + url.pathname).toBe('https://access.line.me/oauth2/v2.1/authorize');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('channel-123');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://www.school-ie.com/api/mypage/line/callback'
      );
      expect(url.searchParams.get('state')).toBe('st');
      expect(url.searchParams.get('nonce')).toBe('no');
    });

    it('scope に openid を含む（id_token を受け取るため）', () => {
      const url = new URL(
        buildAuthorizeUrl({ redirectUri: 'https://x/cb', state: 's', nonce: 'n' })
      );
      expect(url.searchParams.get('scope')?.split(' ')).toContain('openid');
    });

    it('email スコープは要求しない（PIIを持たない設計）', () => {
      const url = new URL(
        buildAuthorizeUrl({ redirectUri: 'https://x/cb', state: 's', nonce: 'n' })
      );
      expect(url.searchParams.get('scope')).not.toContain('email');
    });

    it('既定で bot_prompt=aggressive を付ける（友だち追加を促す）', () => {
      const url = new URL(
        buildAuthorizeUrl({ redirectUri: 'https://x/cb', state: 's', nonce: 'n' })
      );
      expect(url.searchParams.get('bot_prompt')).toBe('aggressive');
    });

    it('LINE_LOGIN_BOT_PROMPT=off なら bot_prompt を付けない（公式アカウント未リンク環境の逃げ道）', () => {
      process.env.LINE_LOGIN_BOT_PROMPT = 'off';
      const url = new URL(
        buildAuthorizeUrl({ redirectUri: 'https://x/cb', state: 's', nonce: 'n' })
      );
      expect(url.searchParams.has('bot_prompt')).toBe(false);
    });

    it('チャネル未設定なら例外を投げる', () => {
      delete process.env.LINE_LOGIN_CHANNEL_ID;
      expect(() =>
        buildAuthorizeUrl({ redirectUri: 'https://x/cb', state: 's', nonce: 'n' })
      ).toThrow();
    });
  });

  describe('buildRedirectUri', () => {
    it('リクエストのオリジンからコールバックURLを導出する', () => {
      expect(buildRedirectUri('http://localhost:3000/api/mypage/line/start?invite=a')).toBe(
        'http://localhost:3000/api/mypage/line/callback'
      );
    });

    it('LINE_LOGIN_REDIRECT_URI があればそれを優先する', () => {
      process.env.LINE_LOGIN_REDIRECT_URI = 'https://override/cb';
      expect(buildRedirectUri('http://localhost:3000/api/mypage/line/start')).toBe(
        'https://override/cb'
      );
    });
  });

  describe('isLineLoginConfigured', () => {
    it('両方の環境変数が揃っているときだけ true', () => {
      expect(isLineLoginConfigured()).toBe(true);
      delete process.env.LINE_LOGIN_CHANNEL_SECRET;
      expect(isLineLoginConfigured()).toBe(false);
    });
  });
});
