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
