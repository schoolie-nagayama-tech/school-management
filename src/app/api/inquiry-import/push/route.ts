/**
 * POST /api/inquiry-import/push — ブックマークレット経由の HP 問合せ CSV 取込エンドポイント。
 *
 * 認証方式: クエリパラメータ `?token=...` の inquiry_import_tokens テーブル照合。
 * ログインセッション不要（Cookie 不使用）のため CORS は * で開放する。
 * body: CSV テキスト（Content-Type: text/plain）
 *
 * セキュリティ:
 *  - anon ポリシーは追加しない（全処理を service role で実行）
 *  - トークンは発行者単位で管理。漏洩時は DELETE /api/inquiry-import/token で一括失効可能。
 *  - CORS を * にしても token 認可があるためリスクは許容範囲内。
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { importInquiryCsvText } from '@/lib/server/inquiryImportPush';
import { apiErrorResponse } from '@/lib/api-error';

// SSR キャッシュ無効化（毎リクエスト実行）
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ============================================================
// CORS ヘッダー（全エンドポイント共通）
// ============================================================

/** 全レスポンスに付与する CORS ヘッダー。Cookie 不使用・トークン認可なので * で安全。 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
} as const;

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
// OPTIONS — プリフライト応答（text/plain は単純リクエストなので本来不要だが保険）
// ============================================================

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

// ============================================================
// POST — CSV 取込本体
// ============================================================

export async function POST(request: NextRequest) {
  // ---- 1. トークン抽出 ----
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json(
      { error: 'トークンが指定されていません' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // ---- 2. CSV テキスト取得 ----
  const csvText = await request.text();
  if (!csvText || !csvText.trim()) {
    return NextResponse.json(
      { error: 'CSV テキストが空です' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const serviceClient = getServiceClient();

  // ---- 3. トークン照合（revoked=false のみ有効）----
  const { data: tokenRow, error: tokenError } = await serviceClient
    .from('inquiry_import_tokens')
    .select('id, token, revoked')
    .eq('token', token)
    .eq('revoked', false)
    .maybeSingle();

  if (tokenError) {
    console.error('[inquiry-import/push] token lookup error:', tokenError);
    return NextResponse.json(
      { error: 'トークン照合に失敗しました' },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  if (!tokenRow) {
    return NextResponse.json(
      { error: '無効なトークンです' },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  // ---- 4. CSV 取込実行 ----
  let importResult;
  try {
    importResult = await importInquiryCsvText(serviceClient, csvText);
  } catch (err) {
    // apiErrorResponse が内部で captureApiError を呼ぶので、ここで二重送信しない。
    // CORS ヘッダは apiErrorResponse が付けないので、返ってきたレスポンスに足す。
    const res = apiErrorResponse(
      err,
      { route: 'POST /api/inquiry-import/push', action: 'import_csv' },
      '問合せCSVの取込に失敗しました。時間をおいて再度お試しください。'
    );
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
    return res;
  }

  // ---- 5. last_used_at を更新（エラーは非致命的なので throw しない）----
  await serviceClient
    .from('inquiry_import_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', tokenRow.id);

  // ---- 6. 結果を返す ----
  return NextResponse.json(importResult, { status: 200, headers: CORS_HEADERS });
}
