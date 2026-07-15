import 'server-only';
import { SignJWT, jwtVerify, importJWK, type JWTPayload, type JWK } from 'jose';

/**
 * 保護者ポータル(v2) の自前署名JWT。
 *
 * 設計（docs/account-line-design.md §4・experiments/portal-auth-poc/poc.mjs で実機検証済み）:
 *   自前ログイン（login_id + パスワード）を検証したあと、Supabase互換のJWTを
 *   自前生成したES256鍵で署名する。Supabase側はこの鍵をインポート＆Rotate済みなので
 *   署名を受理し、RLS内で portal_uid() = JWTの sub（= portal_account_id）として認可する。
 *
 * ★ role は 'authenticated' ではなく専用の 'portal':
 *   既存RLSには「authenticated＝スタッフ」を暗黙仮定した広いポリシーがあり
 *   （subjects 等が ALL using(true)）、authenticated で発行すると保護者にそれらが
 *   適用されてしまう（本番実測済み）。専用 Postgres ロール portal で発行することで
 *   既存 `to authenticated` ポリシー群から構造的に隔離し、デフォルト全拒否＋
 *   明示グラントのみにする（マイグレーション 20260714000000 参照）。
 *
 * 機密の扱い:
 *   署名鍵 PORTAL_JWT_PRIVATE_JWK は service_role key 同格の機密。
 *   クライアントに渡さない・ログに出さない・NEXT_PUBLIC_ 禁止。
 *   この 'server-only' import はクライアントバンドルへの混入をビルド時に弾く保険。
 */

/** JWTの有効期限（24時間）。秒。 */
const EXPIRES_IN_SECONDS = 24 * 60 * 60;

/** ポータルJWTに載せるクレーム（検証結果として返す型）。 */
export interface PortalJwtClaims {
  /** portal_accounts.id */
  sub: string;
  /** 専用Postgresロール。既存の authenticated 向けポリシー群から構造的に隔離する。 */
  role: 'portal';
  aud: 'authenticated';
  /** カスタムクレーム。ポリシーやログでポータルJWTだと判別できるよう付与する。 */
  portal: true;
  iss: string;
  exp: number;
  iat: number;
}

/**
 * 環境変数から署名鍵JWK（ES256秘密鍵）を読む。
 * 呼び出し時に読むことで、鍵未設定でもモジュール読み込み自体は失敗させない
 * （テストで鍵を差し替えられるようにする狙いも兼ねる）。
 */
function loadSigningJwk(): { jwk: Record<string, unknown>; kid: string } {
  const raw = process.env.PORTAL_JWT_PRIVATE_JWK;
  if (!raw) {
    throw new Error('PORTAL_JWT_PRIVATE_JWK が設定されていません');
  }
  let jwk: Record<string, unknown>;
  try {
    jwk = JSON.parse(raw);
  } catch {
    throw new Error('PORTAL_JWT_PRIVATE_JWK が不正なJSONです');
  }
  // ES256の秘密鍵JWK（alg=ES256, d=秘密指数, kid=鍵ID）であることを確認する。
  if (jwk.alg !== 'ES256' || typeof jwk.d !== 'string' || typeof jwk.kid !== 'string') {
    throw new Error('PORTAL_JWT_PRIVATE_JWK が ES256 の秘密鍵JWK(alg/d/kid必須)ではありません');
  }
  return { jwk, kid: jwk.kid as string };
}

/**
 * JWK から WebCrypto が受け付けない用途系フィールドを取り除く。
 *
 * ★ なぜ必要か（2026-07-15 実機で発覚したバグ）:
 *   `supabase gen signing-key` が出す JWK は `key_ops: ["sign","verify"]` を含む。
 *   これをそのまま importJWK に渡すと WebCrypto が
 *     DOMException: Unsupported key usage for a ECDSA key
 *   で落ちる。ECDSA では **秘密鍵は sign のみ・公開鍵は verify のみ**が許され、
 *   両方を持つ鍵は不正だから。結果としてログインが 500 で必ず失敗していた。
 *   鍵JSONをそのまま環境変数に貼るのが自然な運用なので、
 *   「貼られた形に依存せず動く」ようにコード側で落とす（use/ext も同様に不要）。
 */
function stripKeyUsage(jwk: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...jwk };
  delete cleaned.key_ops;
  delete cleaned.use;
  delete cleaned.ext;
  return cleaned;
}

/**
 * Supabaseの issuer（`${SUPABASE_URL}/auth/v1`）を組み立てる。
 * RLS/PostgREST が期待する iss に一致させる。
 */
function getIssuer(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL が設定されていません');
  }
  return `${url}/auth/v1`;
}

/**
 * ポータルアカウント用のSupabase互換JWTを署名して返す。
 *
 * @param portalAccountId  portal_accounts.id（JWTの sub になり portal_uid() として読まれる）
 * @returns 署名済みJWT文字列
 */
export async function signPortalJwt(portalAccountId: string): Promise<string> {
  const { jwk, kid } = loadSigningJwk();
  // key_ops 等を落としてから読む（そのまま渡すと WebCrypto が弾く。stripKeyUsage 参照）
  const privateKey = await importJWK(stripKeyUsage(jwk) as JWK, 'ES256');
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({
    // PostgREST がこのクレームで pg ロールを 'portal' に切り替える（専用ロールで隔離）。
    role: 'portal',
    aud: 'authenticated',
    // ポリシーやログでポータルJWTだと判別できるようにするカスタムクレーム。
    portal: true,
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid })
    .setSubject(portalAccountId)
    .setIssuedAt(now)
    .setExpirationTime(now + EXPIRES_IN_SECONDS)
    .setIssuer(getIssuer())
    .sign(privateKey);
}

/**
 * ポータルJWTを検証し、正当ならクレームを返す。無効なら null。
 * 公開鍵は秘密鍵JWKから `d` を取り除いて導出する（別途公開鍵を管理しない）。
 *
 * @param token  検証するJWT文字列
 * @returns 正当なら PortalJwtClaims、無効/期限切れ等は null
 */
export async function verifyPortalJwt(token: string): Promise<PortalJwtClaims | null> {
  try {
    const { jwk } = loadSigningJwk();
    // 秘密指数 d を落として公開鍵JWKにする。
    // key_ops 等も落とす（公開鍵に "sign" が残っていると WebCrypto が弾く。stripKeyUsage 参照）。
    const publicJwk = stripKeyUsage(jwk);
    delete publicJwk.d;
    const publicKey = await importJWK(publicJwk as JWK, 'ES256');

    const { payload } = await jwtVerify(token, publicKey, {
      issuer: getIssuer(),
      audience: 'authenticated',
    });

    // 期待するクレームが揃っているか最終確認する。
    if (!isPortalPayload(payload)) return null;

    return {
      sub: payload.sub as string,
      role: 'portal',
      aud: 'authenticated',
      portal: true,
      iss: payload.iss as string,
      exp: payload.exp as number,
      iat: payload.iat as number,
    };
  } catch {
    // 署名不正・期限切れ・issuer不一致などはすべて「無効」として null を返す。
    return null;
  }
}

/** payload が期待するポータルクレームを満たすかの型ガード。 */
function isPortalPayload(payload: JWTPayload): boolean {
  return (
    typeof payload.sub === 'string' &&
    payload.sub.length > 0 &&
    // 専用ロール。'authenticated'（スタッフ相当）のJWTはポータルセッションとして扱わない。
    payload.role === 'portal' &&
    payload.portal === true &&
    typeof payload.exp === 'number' &&
    typeof payload.iat === 'number'
  );
}
