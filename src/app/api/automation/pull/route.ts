/**
 * GET /api/automation/pull?token=... — ローダー・ブックマークレットが保留ジョブを取得する。
 *
 * 認証方式: クエリ ?token=... の automation_tokens 照合（ログインセッション不要）。
 * 対象サイト(日本教材出版/スクールIE等)から fetch されるため CORS は * で開放する。
 * inquiry-import/push と同じ「bearerトークン＋service role＋CORS*」方式。
 *
 * 取得した保留ジョブ(pending_payload)はレスポンス後にクリアする（1回限りの受け渡し）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** CORS: Cookie不使用・トークン認可なので * で安全。 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
} as const;

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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json(
      { error: 'トークンが指定されていません' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const serviceClient = getServiceClient();

  // トークン照合（revoked=false のみ有効）＋保留ジョブ取得
  const { data: row, error } = await serviceClient
    .from('automation_tokens')
    .select('id, pending_payload')
    .eq('token', token)
    .eq('revoked', false)
    .maybeSingle();

  if (error) {
    console.error('[automation/pull] token lookup error:', error);
    return NextResponse.json(
      { error: 'トークン照合に失敗しました' },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  if (!row) {
    return NextResponse.json(
      { error: '無効なトークンです' },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const payload = row.pending_payload ?? null;

  // 取得後にクリア＋last_used_at更新（1回限りの受け渡し。失敗は非致命的）
  await serviceClient
    .from('automation_tokens')
    .update({ pending_payload: null, pending_at: null, last_used_at: new Date().toISOString() })
    .eq('id', row.id);

  return NextResponse.json({ payload }, { status: 200, headers: CORS_HEADERS });
}
