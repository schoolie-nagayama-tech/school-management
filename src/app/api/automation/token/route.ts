/**
 * /api/automation/token — 自動入力ローダー・ブックマークレット用トークンの発行・失効。
 *
 * POST: そのユーザー(created_by=auth.uid)の revoked=false の既存トークンがあれば再利用、
 *       なければ新規生成。レスポンス: { token: string }
 * DELETE: そのユーザーの全トークンを revoked=true に設定（漏洩時の一括失効用）。
 *
 * 認証: requireManager（教室長以上）。inquiry-import/token と同じパターン。
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireManager, getApiAuth } from '@/lib/api-auth';
import crypto from 'crypto';

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
  const authError = await requireManager(request);
  if (authError) return authError;

  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  const userId = auth.userId;

  let label = '自動入力ローダー';
  try {
    const body = (await request.json()) as { label?: string };
    if (body.label && typeof body.label === 'string') {
      label = body.label.trim() || label;
    }
  } catch {
    // 空 body 等はデフォルト label を使用
  }

  const serviceClient = getServiceClient();

  const { data: existing, error: lookupError } = await serviceClient
    .from('automation_tokens')
    .select('token')
    .eq('created_by', userId)
    .eq('revoked', false)
    .maybeSingle();

  if (lookupError) {
    console.error('[automation/token] POST lookup error:', lookupError);
    return NextResponse.json({ error: 'トークン照合に失敗しました' }, { status: 500 });
  }

  if (existing?.token) {
    return NextResponse.json({ token: existing.token });
  }

  const newToken = crypto.randomBytes(24).toString('base64url');

  const { error: insertError } = await serviceClient
    .from('automation_tokens')
    .insert({ token: newToken, label, created_by: userId, revoked: false });

  if (insertError) {
    console.error('[automation/token] POST insert error:', insertError);
    return NextResponse.json({ error: 'トークンの作成に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ token: newToken });
}

// ============================================================
// DELETE — 全トークン失効
// ============================================================
export async function DELETE(request: NextRequest) {
  const authError = await requireManager(request);
  if (authError) return authError;

  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  const userId = auth.userId;

  const serviceClient = getServiceClient();
  const { error } = await serviceClient
    .from('automation_tokens')
    .update({ revoked: true })
    .eq('created_by', userId)
    .eq('revoked', false);

  if (error) {
    console.error('[automation/token] DELETE error:', error);
    return NextResponse.json({ error: 'トークンの失効に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
