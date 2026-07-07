/**
 * 公開API: 追客メールの配信停止（オプトアウト）
 *
 * GET  /api/inquiries/unsubscribe?token=... — トークンの有効性と現在の配信停止状態を返す
 * POST /api/inquiries/unsubscribe            — { token } を受けて配信停止にする
 *
 * 認証: なし（メール内リンクから保護者が直接アクセスするため）。
 * 権限: service role で操作（RLS をバイパス）。
 *
 * セキュリティ:
 *   - 照合は推測不能な email_opt_out_token（uuid）のみ。id は露出しない。
 *   - メールスキャナの GET プリフェッチによる誤配信停止を避けるため、
 *     実際の停止は POST（本人がボタンを押す）でのみ行う。GET は状態確認だけ。
 *   - 個人情報は返さない（found / alreadyOptedOut のみ）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/** service role クライアントを生成する */
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env not set');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** uuid の形かどうかの軽いバリデーション（総当たり時の無駄クエリを減らす） */
function looksLikeUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// ============================================================
// GET: 状態確認（停止はしない）
// ============================================================

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  if (!token || !looksLikeUuid(token)) {
    return NextResponse.json({ found: false }, { status: 200 });
  }

  const service = getServiceClient();
  const { data, error } = await service
    .from('inquiries')
    .select('id, email_opt_out')
    .eq('email_opt_out_token', token)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    console.error('[unsubscribe] 状態確認エラー:', error.message);
    return NextResponse.json({ error: '確認に失敗しました' }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ found: false }, { status: 200 });
  }

  return NextResponse.json({ found: true, alreadyOptedOut: !!data.email_opt_out });
}

// ============================================================
// POST: 配信停止を確定する
// ============================================================

export async function POST(request: NextRequest) {
  let token = '';
  try {
    const body = await request.json();
    token = typeof body?.token === 'string' ? body.token : '';
  } catch {
    // ボディ無し・不正JSON はトークン無し扱い
  }

  if (!token || !looksLikeUuid(token)) {
    return NextResponse.json({ error: 'リンクが正しくありません' }, { status: 400 });
  }

  const service = getServiceClient();

  // トークンで対象を特定
  const { data: target, error: findError } = await service
    .from('inquiries')
    .select('id, email_opt_out')
    .eq('email_opt_out_token', token)
    .is('deleted_at', null)
    .maybeSingle();

  if (findError) {
    console.error('[unsubscribe] 対象検索エラー:', findError.message);
    return NextResponse.json({ error: '処理に失敗しました' }, { status: 500 });
  }

  if (!target) {
    return NextResponse.json({ error: 'リンクが無効です' }, { status: 404 });
  }

  // 既に停止済みなら何もしない（冪等）
  if (target.email_opt_out) {
    return NextResponse.json({ success: true, alreadyOptedOut: true });
  }

  const { error: updateError } = await service
    .from('inquiries')
    .update({
      email_opt_out: true,
      email_opt_out_at: new Date().toISOString(),
      email_opt_out_source: 'unsubscribe_link',
      updated_at: new Date().toISOString(),
    })
    .eq('id', target.id);

  if (updateError) {
    console.error('[unsubscribe] 更新エラー:', updateError.message);
    return NextResponse.json({ error: '処理に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ success: true, alreadyOptedOut: false });
}
