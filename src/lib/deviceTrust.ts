import crypto from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * 教室端末マーク（信頼済み端末）の発行・照合まわり。
 *
 * 正典: docs/teacher-home-mode-plan.md §2
 *
 * ★ サーバー専用モジュール。
 *   service role 鍵で trusted_devices を直接読むため、クライアントから import しては
 *   いけない（`server-only` パッケージはこのプロジェクトに未導入なので、Next.js の
 *   webpack エイリアス頼みの import はせず、この注意書きで運用する）。
 *   ブラウザ側が知ってよいのは /api/device-trust/status が返す boolean だけ。
 *
 * ★ 判定不能は必ず「信頼しない」側に倒す:
 *   クッキー無し・DBエラー・env 未設定 → 家モード扱い。逆に倒すと、障害時に
 *   全講師が家から生徒情報を開けるという最悪の失敗になる。
 */

/**
 * 教室端末マークの長期クッキー名。
 *
 * httpOnly なので JS からは読めない（＝ブラウザ側で「自分は教室端末だ」と
 * 詐称できない）。判定はサーバーだけが行う。
 */
export const NEST_TRUSTED_DEVICE_COOKIE = 'nest_trusted_device';

/** クッキーの寿命（2年）。教室の共有PCに一度だけ発行して使い続ける想定（§2）。 */
export const TRUSTED_DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2;

/**
 * last_seen_at を更新する最短間隔（24時間）。
 * 講師のページ遷移のたびに書き込むと無駄な UPDATE が積み上がるため間引く。
 */
export const TRUSTED_DEVICE_LAST_SEEN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 教室端末マークのトークン（32byte の乱数を hex 化）。ブラウザにだけ渡す平文。 */
export function generateTrustedDeviceToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * トークンの保存形。DBには hash しか置かない（§2）。
 * トークンは十分長い乱数なので、salt 無しの sha256 で辞書攻撃の心配はない。
 */
export function hashTrustedDeviceToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** trusted_devices を読み書きする service role クライアント（RLSはポリシー0＝全拒否）。 */
export function getTrustedDeviceServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase env not set');
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** 発行時に付ける Set-Cookie の属性（§2: httpOnly / Secure / SameSite=Lax / 2年 / path=/）。 */
export function trustedDeviceCookieOptions() {
  return {
    httpOnly: true,
    // ローカル開発は http なので本番のみ Secure（lib/mypage/session.ts と同じ方針）
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: TRUSTED_DEVICE_COOKIE_MAX_AGE_SECONDS,
  };
}

/** レスポンスに教室端末マークのクッキーを載せる。 */
export function setTrustedDeviceCookie(response: NextResponse, token: string): void {
  response.cookies.set(NEST_TRUSTED_DEVICE_COOKIE, token, trustedDeviceCookieOptions());
}

/** 照合で必要になる最小限の端末情報（token_hash は絶対に持ち出さない）。 */
export interface TrustedDeviceRecord {
  id: string;
  school_id: string;
  label: string;
  last_seen_at: string | null;
}

/**
 * リクエストのクッキーから「信頼済み端末か」を照合する。
 *
 * @returns 信頼済みならその端末行、そうでなければ null（クッキー無し・失効済み・
 *          DBエラーのいずれも null ＝ 信頼しない側に倒す）
 */
export async function lookupTrustedDevice(
  request: NextRequest
): Promise<TrustedDeviceRecord | null> {
  const token = request.cookies.get(NEST_TRUSTED_DEVICE_COOKIE)?.value;
  if (!token) return null;

  try {
    const db = getTrustedDeviceServiceClient();
    const { data, error } = await db
      .from('trusted_devices')
      .select('id, school_id, label, last_seen_at')
      .eq('token_hash', hashTrustedDeviceToken(token))
      .is('revoked_at', null)
      .maybeSingle();

    if (error) {
      console.error('[deviceTrust] 端末照合に失敗しました:', error);
      return null;
    }
    return (data as TrustedDeviceRecord | null) ?? null;
  } catch (e) {
    console.error('[deviceTrust] 端末照合で例外:', e);
    return null;
  }
}

/**
 * 「このリクエストは教室端末からか」を boolean で返す独立ヘルパー。
 *
 * ★ getApiAuth には組み込まない:
 *   getApiAuth は全 API ルートが毎回呼ぶ共通処理なので、ここに trusted_devices の
 *   照合（＋1クエリ）を足すと全APIが一律に遅くなる。教室限定を強制したいルートだけが
 *   この関数を呼ぶ形にして、既存ルートの挙動とコストを変えない。
 */
export async function isRequestFromTrustedDevice(request: NextRequest): Promise<boolean> {
  return (await lookupTrustedDevice(request)) !== null;
}

/**
 * last_seen_at を更新する（前回から24時間以上経っているときだけ）。
 * 失敗しても判定結果には影響しないので握りつぶす（棚卸し用の情報にすぎない）。
 */
export async function touchTrustedDeviceLastSeen(device: TrustedDeviceRecord): Promise<void> {
  const now = Date.now();
  if (
    device.last_seen_at &&
    now - new Date(device.last_seen_at).getTime() < TRUSTED_DEVICE_LAST_SEEN_INTERVAL_MS
  ) {
    return;
  }
  try {
    const db = getTrustedDeviceServiceClient();
    await db
      .from('trusted_devices')
      .update({ last_seen_at: new Date(now).toISOString() })
      .eq('id', device.id);
  } catch (e) {
    console.error('[deviceTrust] last_seen_at の更新に失敗しました:', e);
  }
}
