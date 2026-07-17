/**
 * jwt.ts ユニットテスト（保護者ポータルの自前署名JWT）。
 *
 * 実鍵（PORTAL_JWT_PRIVATE_JWK）は機密なので、テストでは jose でその場に
 * ES256 鍵ペアを生成して env に流し込み、署名→検証の往復を確認する。
 */
// jwt.ts は 'server-only' を import するため、node のテスト環境では空モジュールに差し替える。
vi.mock('server-only', () => ({}));

import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, exportJWK } from 'jose';
import { signPortalJwt, verifyPortalJwt } from '@/lib/mypage/jwt';

const SUB = '11111111-1111-1111-1111-111111111111';

beforeAll(async () => {
  // ES256 鍵ペアを生成し、秘密鍵JWK（alg/kid付き）を env に設定する。
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  jwk.alg = 'ES256';
  jwk.kid = 'test-kid';
  // ★ 実運用の鍵の形を再現する（2026-07-15 の実機バグの再発防止）:
  //   `supabase gen signing-key` が出す JWK は use/key_ops/ext を含む。
  //   その JWK をそのまま環境変数に貼るのが自然な運用だが、key_ops:["sign","verify"] を
  //   WebCrypto に渡すと ECDSA では不正（秘密鍵は sign のみ）として弾かれ、
  //   ログインが 500 で必ず失敗する。テストが jose 生成のクリーンな JWK を使っていたため
  //   この不整合を見逃していた。ここで実鍵と同じ形にしておく。
  jwk.use = 'sig';
  jwk.key_ops = ['sign', 'verify'];
  jwk.ext = true;
  process.env.PORTAL_JWT_PRIVATE_JWK = JSON.stringify(jwk);
  // iss 用（vitest.config の env で https://test.supabase.co が入っている前提だが明示）。
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co';
});

describe('signPortalJwt / verifyPortalJwt', () => {
  it('署名したJWTを検証すると期待クレームが返る', async () => {
    const token = await signPortalJwt(SUB);
    expect(typeof token).toBe('string');

    const claims = await verifyPortalJwt(token);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe(SUB);
    // 専用Postgresロール（authenticated だと既存スタッフ向けポリシーが波及するため）。
    expect(claims!.role).toBe('portal');
    expect(claims!.aud).toBe('authenticated');
    expect(claims!.portal).toBe(true);
    expect(claims!.iss).toBe(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`);
    // exp は iat より後（24時間後付近）。
    expect(claims!.exp).toBeGreaterThan(claims!.iat);
  });

  it('demo オプション付きで署名すると demo クレームが立つ', async () => {
    // デモセッションはフラグ OFF でも /mypage を通れる唯一の鍵。
    // 署名鍵で守られていることが前提なので、往復で確実に立つことを固定する。
    const token = await signPortalJwt(SUB, { demo: true });
    const claims = await verifyPortalJwt(token);
    expect(claims).not.toBeNull();
    expect(claims!.demo).toBe(true);
    // デモでも主体は通常のポータルセッションと同じ（RLSの扱いを変えない）。
    expect(claims!.sub).toBe(SUB);
    expect(claims!.role).toBe('portal');
  });

  it('demo 指定なしの通常ログインでは demo が立たない', async () => {
    // 既存（保護者の実ログイン）の挙動を変えないことの固定。
    const token = await signPortalJwt(SUB);
    const claims = await verifyPortalJwt(token);
    expect(claims!.demo).toBeFalsy();
  });

  it('demo:false を渡してもクレームは載らない', async () => {
    const token = await signPortalJwt(SUB, { demo: false });
    const claims = await verifyPortalJwt(token);
    expect(claims!.demo).toBe(false);
  });

  it('改ざんされたトークンは null を返す', async () => {
    const token = await signPortalJwt(SUB);
    // 署名部を1文字書き換える。
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'b' : 'a');
    const claims = await verifyPortalJwt(tampered);
    expect(claims).toBeNull();
  });

  it('でたらめな文字列は null を返す', async () => {
    expect(await verifyPortalJwt('not-a-jwt')).toBeNull();
  });

  it('別の鍵で署名されたトークンは受理しない', async () => {
    // 攻撃者が自前の鍵で同じクレームを署名しても、公開鍵が違うので弾かれる。
    const { privateKey: otherKey } = await generateKeyPair('ES256', { extractable: true });
    const { SignJWT } = await import('jose');
    const now = Math.floor(Date.now() / 1000);
    const forged = await new SignJWT({ role: 'portal', aud: 'authenticated', portal: true })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'test-kid' })
      .setSubject(SUB)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .setIssuer(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`)
      .sign(otherKey);

    expect(await verifyPortalJwt(forged)).toBeNull();
  });

  it('role が portal でないトークンはポータルセッションとして受理しない', async () => {
    // 正規の鍵で署名されていても role:'authenticated'（スタッフ相当）の
    // トークンは portal_session に流用できない（クレーム検証で弾く）。
    const { SignJWT, importJWK } = await import('jose');
    const jwk = JSON.parse(process.env.PORTAL_JWT_PRIVATE_JWK!);
    // テスト側も key_ops 等を落としてから読む（実装と同じ理由。上の beforeAll のコメント参照）
    delete jwk.key_ops;
    delete jwk.use;
    delete jwk.ext;
    const key = await importJWK(jwk, 'ES256');
    const now = Math.floor(Date.now() / 1000);
    const staffLike = await new SignJWT({
      role: 'authenticated',
      aud: 'authenticated',
      portal: true,
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'test-kid' })
      .setSubject(SUB)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .setIssuer(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`)
      .sign(key);

    expect(await verifyPortalJwt(staffLike)).toBeNull();
  });
});
