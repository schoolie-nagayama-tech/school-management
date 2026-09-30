// @ts-nocheck
// ============================================================
// Edge Function 共通の呼び出し元認証ガード
//
// なぜ必要か（実際にあった穴）:
//   send-inquiry-mail / send-form-notification は呼び出し元を確かめていなかった。
//   ゲートウェイの verify_jwt は「このプロジェクトが署名した JWT か」しか見ないため、
//   ブラウザのバンドルに入っている公開の anon key（これも JWT）で素通りする。
//   結果、誰でも /functions/v1/send-inquiry-mail に to/subject/body/fromName を投げて、
//   教室名義・正規ドメイン(noreply@school-ie.com)でフィッシングメールを送れた。
//   ここで「サーバー（service role）」か「有効なスタッフのログイン JWT」だけを通す。
//
// 通すもの:
//   a. Bearer が SUPABASE_SERVICE_ROLE_KEY と一致 → Next.js のサーバールート / DB トリガー
//   b. Bearer がログインユーザーの JWT で、user_profiles が有効かつ minRole 以上
// それ以外（anon key・ヘッダー無し・プロフィール無し・保護者など）は 401/403。
//
// 注意: tsconfig の include が **/*.ts のため CI の型チェック対象に入る。
// Deno 固有 API と URL import を使うので @ts-nocheck で除外している（他の関数と同じ扱い）。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')

// ロールの序列は src/types/database.ts の USER_ROLE_LEVELS と同じ値にそろえる。
// Edge Function（Deno）からアプリ側の TS を import できないため複製している。
// parent(1) は保護者で、ここを通してはいけない（スタッフ向けの送信機能のため）。
const ROLE_LEVELS: Record<string, number> = {
  parent: 1,
  teacher: 2,
  manager: 3,
  owner: 4,
  admin: 5,
}

export type StaffRole = 'teacher' | 'manager' | 'owner' | 'admin'

export type AuthResult =
  | { ok: true; kind: 'service' }
  | { ok: true; kind: 'user'; userId: string; role: string; token: string }
  | { ok: false; response: Response }

// サービスロールのクライアント（プロフィール照会用）。RLS を越えて読むのは
// 「呼び出し元のロールを確かめる」ためだけで、呼び出し元の入力で絞り込みはしない。
let adminClient: ReturnType<typeof createClient> | null = null
function getAdminClient() {
  if (!adminClient) {
    adminClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return adminClient
}

function jsonError(status: number, message: string, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function extractBearer(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? req.headers.get('authorization')
  if (!header) return null
  const m = header.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

/**
 * 定数時間比較。単純な === は先頭から一致した長さで応答時間が変わり、
 * service role key を1文字ずつ推測される余地があるため使わない。
 * 双方を SHA-256 にしてから比べるので、長さの違いも時間に出ない。
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const va = new Uint8Array(ha)
  const vb = new Uint8Array(hb)
  let diff = 0
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i]
  return diff === 0
}

/** JWT の payload を「検証せずに」読む。分岐の判断材料にだけ使い、信用はしない。 */
function peekJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

/**
 * role=service_role を名乗る JWT が、文字列としては SUPABASE_SERVICE_ROLE_KEY と
 * 違う場合の確認。DB トリガー(pg_net)は Vault に移した service_role JWT を送っており、
 * これが関数の環境変数と「同じ文字列」である保証がない（発行時期違いの正規 JWT など）。
 * 完全一致だけにするとフォーム申込メールが静かに止まるため、Auth の管理 API に
 * そのトークンで問い合わせ、署名とロールを Auth サーバー側に検証させる。
 * 管理 API は正規の service_role JWT でないと 401/403 を返すので、偽造は通らない。
 */
async function verifyServiceRoleJwtViaAuth(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: {
        apikey: SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY || '',
        Authorization: `Bearer ${token}`,
      },
    })
    // 本文は不要。接続を解放するため読み捨てる。
    await res.body?.cancel()
    return res.ok
  } catch {
    return false
  }
}

/**
 * 呼び出し元を認証する。
 * @param minRole ユーザー JWT で呼ばれたときに要求する最低ロール
 * @param corsHeaders 401/403 応答にも付ける CORS ヘッダー（付けないとブラウザ側で
 *                    エラー内容が読めず、原因不明の失敗に見えるため）
 */
export async function authorizeRequest(
  req: Request,
  minRole: StaffRole,
  corsHeaders: Record<string, string> = {}
): Promise<AuthResult> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // 設定漏れで「全部通す」側に倒れないよう、判定できないときは拒否する
    console.error('[auth] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
    return { ok: false, response: jsonError(500, '認証設定が不正です', corsHeaders) }
  }

  const token = extractBearer(req)
  if (!token) {
    return { ok: false, response: jsonError(401, '認証が必要です', corsHeaders) }
  }

  // a. サーバー / DB トリガーからの呼び出し
  if (await timingSafeEqual(token, SUPABASE_SERVICE_ROLE_KEY)) {
    return { ok: true, kind: 'service' }
  }

  const claims = peekJwtPayload(token)
  if (claims?.role === 'service_role') {
    if (await verifyServiceRoleJwtViaAuth(token)) {
      return { ok: true, kind: 'service' }
    }
    return { ok: false, response: jsonError(401, '認証に失敗しました', corsHeaders) }
  }

  // anon key はここで弾く（getUser でも sub が無く失敗するが、無駄な問い合わせを省く）
  if (claims?.role === 'anon' || (SUPABASE_ANON_KEY && token === SUPABASE_ANON_KEY)) {
    return { ok: false, response: jsonError(401, 'ログインが必要です', corsHeaders) }
  }

  // b. ログインユーザーの JWT。署名・失効は Auth サーバーに確認させる（payload は信用しない）
  const admin = getAdminClient()
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  const user = userData?.user
  if (userError || !user) {
    return { ok: false, response: jsonError(401, 'ログインが必要です', corsHeaders) }
  }

  const { data: profile, error: profileError } = await admin
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    console.error('[auth] user_profiles 取得エラー:', profileError)
    return { ok: false, response: jsonError(500, '権限の確認に失敗しました', corsHeaders) }
  }
  // is_active は DEFAULT true の nullable 列。無効化は明示的に false を入れる運用なので
  // false だけを弾き、null は既定値（有効）として扱う。
  if (!profile || profile.is_active === false) {
    return { ok: false, response: jsonError(403, 'この操作の権限がありません', corsHeaders) }
  }

  const level = ROLE_LEVELS[String(profile.role)] ?? 0
  if (level < ROLE_LEVELS[minRole]) {
    return { ok: false, response: jsonError(403, 'この操作の権限がありません', corsHeaders) }
  }

  return { ok: true, kind: 'user', userId: user.id, role: String(profile.role), token }
}
