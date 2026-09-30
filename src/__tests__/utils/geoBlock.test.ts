/**
 * 国単位のアクセス制限（src/lib/utils/geoBlock.ts）の境界を固定する。
 *
 * ★ なぜこのテストが要るか:
 *   例外パスを消すと LINE・Slack などの Webhook（海外のサーバーから届く）や Vercel Cron が
 *   黙って 403 になり、通知・定期処理が止まる。逆に例外を広げすぎると制限の意味が無くなる。
 */
import { describe, it, expect } from 'vitest';
import { isGeoBlocked, parseAllowedCountries } from '@/lib/utils/geoBlock';

const JP_ONLY = ['JP'];

describe('isGeoBlocked', () => {
  it('日本からのアクセスは通す', () => {
    expect(isGeoBlocked({ country: 'JP', pathname: '/login', allowedCountries: JP_ONLY })).toBe(
      false
    );
  });

  it.each(['/login', '/mypage', '/api/mypage/login', '/students', '/api/admin/users'])(
    '海外から %s は止める',
    (pathname) => {
      expect(isGeoBlocked({ country: 'US', pathname, allowedCountries: JP_ONLY })).toBe(true);
    }
  );

  it.each([
    '/api/webhooks/resend',
    '/api/webhooks/slack/notta',
    '/api/mypage/line/webhook',
    '/api/cron/daily-material-report',
  ])('海外からでも %s（Webhook・Cron）は通す', (pathname) => {
    expect(isGeoBlocked({ country: 'US', pathname, allowedCountries: JP_ONLY })).toBe(false);
  });

  it('LINEログインのコールバック（保護者のブラウザが来る）は例外にしない', () => {
    expect(
      isGeoBlocked({
        country: 'US',
        pathname: '/api/mypage/line/callback',
        allowedCountries: JP_ONLY,
      })
    ).toBe(true);
  });

  it('国のヘッダーが無い（ローカル開発）なら止めない', () => {
    expect(isGeoBlocked({ country: null, pathname: '/login', allowedCountries: JP_ONLY })).toBe(
      false
    );
  });

  it('非常口（disabled）なら止めない', () => {
    expect(
      isGeoBlocked({ country: 'US', pathname: '/login', allowedCountries: JP_ONLY, disabled: true })
    ).toBe(false);
  });

  it('小文字の国コードでも判定できる', () => {
    expect(isGeoBlocked({ country: 'jp', pathname: '/login', allowedCountries: JP_ONLY })).toBe(
      false
    );
  });
});

describe('parseAllowedCountries', () => {
  it('未設定・空なら日本のみ', () => {
    expect(parseAllowedCountries(undefined)).toEqual(['JP']);
    expect(parseAllowedCountries('')).toEqual(['JP']);
  });

  it('カンマ区切りを大文字にそろえ、不正な値は捨てる', () => {
    expect(parseAllowedCountries('jp, us ,xxx,1')).toEqual(['JP', 'US']);
  });
});
