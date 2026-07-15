import 'server-only';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPortalContext } from './supabase';
import { getPortalServiceClient } from './serviceClient';
import { verifyPortalLink } from './chatService';
import type { PortalJwtClaims } from './jwt';

/**
 * ポータル API 共通の認可（Stage 3 で共通化）。
 *
 * ★ なぜ共通化するか:
 *   Stage3 で service role を使う API（残り振替回数・手続きハブ）が増える。service role は
 *   RLS をバイパスするため、「セッションが有効か」＋「その studentId が自分の紐づけ生徒か」の
 *   2段検証を各ルートが自前で書くと、1箇所書き忘れただけで他人の生徒の情報が漏れる。
 *   入口を1つにして、書き忘れが構造的に起きないようにする。
 *
 * 使い方:
 *   const auth = await requirePortalStudent(studentId);
 *   if ('error' in auth) return auth.error;   // 401/403 のレスポンスがそのまま返る
 *   auth.accountId / auth.client / auth.svc を使う
 */

/** 認可成功時の文脈。 */
export interface PortalStudentAuth {
  /** ポータルアカウントID（JWTの sub）。 */
  accountId: string;
  claims: PortalJwtClaims;
  /** ポータルJWTのクライアント（RLSが効く。読み取りは原則こちら）。 */
  client: SupabaseClient;
  /** service role クライアント（RLSバイパス。判定・書き込み用）。 */
  svc: SupabaseClient;
}

/**
 * セッション検証 ＋ studentId の紐づけ検証をまとめて行う。
 *
 * @param studentId 対象生徒
 * @returns 成功なら文脈、失敗なら返すべき NextResponse を持つオブジェクト
 */
export async function requirePortalStudent(
  studentId: string
): Promise<PortalStudentAuth | { error: NextResponse }> {
  const ctx = await getPortalContext();
  if (!ctx) {
    return { error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) };
  }
  const accountId = ctx.claims.sub;
  const svc = getPortalServiceClient();

  if (!(await verifyPortalLink(accountId, studentId, svc))) {
    return { error: NextResponse.json({ error: '権限がありません' }, { status: 403 }) };
  }

  return { accountId, claims: ctx.claims, client: ctx.client, svc };
}

/**
 * セッションだけを検証する（生徒指定が無い API 用。例: 兄弟ぶんをまとめて返す手続きハブ）。
 *
 * ★ 生徒の絞り込みは呼び出し側が必ず「紐づけ生徒の集合」から行うこと。
 *   この関数は「ログインしていること」しか保証しない。
 */
export async function requirePortalSession(): Promise<
  | { accountId: string; claims: PortalJwtClaims; client: SupabaseClient; svc: SupabaseClient }
  | { error: NextResponse }
> {
  const ctx = await getPortalContext();
  if (!ctx) {
    return { error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) };
  }
  return {
    accountId: ctx.claims.sub,
    claims: ctx.claims,
    client: ctx.client,
    svc: getPortalServiceClient(),
  };
}

/**
 * 自分の紐づけ生徒のうち「在籍中」の生徒IDを返す。
 *
 * ★ ポータルJWTのクライアントで students を読む（service role ではない）理由:
 *   Stage1 の portal_students_select_linked（紐づけ＋在籍中）を効かせるため。
 *   退塾超過の失効判定を RLS に任せることで、失効条件をアプリ側に二重実装しない。
 */
export async function listLinkedActiveStudentIds(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.from('students').select('id');
  if (error) {
    console.error('[mypage/portalAuth] 紐づけ生徒の取得に失敗:', error.message);
    return [];
  }
  return (data ?? []).map((r: { id: string }) => r.id);
}
