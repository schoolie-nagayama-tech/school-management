/**
 * /api/inquiry-import/token — ブックマークレット用トークンの発行・失効エンドポイント。
 *
 * POST: そのユーザー(created_by=auth.uid)の revoked=false の既存トークンがあれば再利用、
 *       なければ新規生成。レスポンス: { token: string }
 * DELETE: そのユーザーの全トークンを revoked=true に設定（漏洩時の一括失効用）。
 *         レスポンス: { success: true }
 *
 * 認証: requireAdmin（admin / owner のみ）
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, getApiAuth } from '@/lib/api-auth';
import crypto from 'crypto';

/**
 * Service Role の Supabase クライアントを生成する。
 * inquiry-form/route.ts と同じパターン。
 */
function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase env not set');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ============================================================
// POST — トークン発行（既存があれば再利用）
// ============================================================

export async function POST(request: NextRequest) {
  // requireAdmin は失敗時に NextResponse を返す、成功時に null を返す
  const authError = await requireAdmin(request);
  if (authError) return authError;

  // auth.uid 取得（requireAdmin 通過後なので auth は必ず存在する）
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  const userId = auth.userId;

  // リクエストボディからオプションの label を取得
  let label: string | null = '管理画面発行';
  try {
    const body = await request.json() as { label?: string };
    if (body.label && typeof body.label === 'string') {
      label = body.label.trim() || '管理画面発行';
    }
  } catch {
    // body が JSON でない（空 body など）場合はデフォルト label を使用
  }

  const serviceClient = getServiceClient();

  // ---- 既存の有効トークンがあれば再利用 ----
  const { data: existing, error: lookupError } = await serviceClient
    .from('inquiry_import_tokens')
    .select('token')
    .eq('created_by', userId)
    .eq('revoked', false)
    .maybeSingle();

  if (lookupError) {
    console.error('[inquiry-import/token] POST lookup error:', lookupError);
    return NextResponse.json(
      { error: 'トークン照合に失敗しました' },
      { status: 500 }
    );
  }

  if (existing?.token) {
    // 既存トークンを再利用
    return NextResponse.json({ token: existing.token });
  }

  // ---- 新規トークン生成（base64url: URL-safe かつ予測不能） ----
  const newToken = crypto.randomBytes(24).toString('base64url');

  const { error: insertError } = await serviceClient
    .from('inquiry_import_tokens')
    .insert({
      token: newToken,
      label,
      created_by: userId,
      revoked: false,
    });

  if (insertError) {
    console.error('[inquiry-import/token] POST insert error:', insertError);
    return NextResponse.json(
      { error: 'トークンの作成に失敗しました' },
      { status: 500 }
    );
  }

  return NextResponse.json({ token: newToken });
}

// ============================================================
// DELETE — 全トークン失効（漏洩時の一括無効化）
// ============================================================

export async function DELETE(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  const userId = auth.userId;

  const serviceClient = getServiceClient();

  // そのユーザーの全トークンを revoked=true に更新
  const { error } = await serviceClient
    .from('inquiry_import_tokens')
    .update({ revoked: true })
    .eq('created_by', userId)
    .eq('revoked', false);

  if (error) {
    console.error('[inquiry-import/token] DELETE error:', error);
    return NextResponse.json(
      { error: 'トークンの失効に失敗しました' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
