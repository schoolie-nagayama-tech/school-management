import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase env not set');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * 招待トークンから招待情報を1件だけ返す公開エンドポイント（サービスロール）。
 *
 * 以前は招待受諾ページがブラウザの anon クライアントで user_invitations を直読みしており、
 * RLS が `USING(true)` だったため anon が「フィルタ無しの SELECT」で全招待
 * （トークン・宛先メール・付与ロール）を列挙できてしまっていた。
 * トークン照合はクエリ条件であり RLS ポリシーでは表現できないため、
 * サービスロール経由でトークン一致の1件だけを返すこのAPIに移し、
 * user_invitations の anon SELECT ポリシーを削除する。
 *
 * 未受諾（accepted_at IS NULL）かつ未失効のものだけを返す。
 */
export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ error: 'token が必要です' }, { status: 400 });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: invitation, error } = await supabaseAdmin
      .from('user_invitations')
      .select('id, email, role, school_ids, token, expires_at, accepted_at, created_at')
      .eq('token', token)
      .is('accepted_at', null)
      .maybeSingle();

    if (error || !invitation) {
      return NextResponse.json({ error: '招待が見つかりません' }, { status: 404 });
    }

    // 有効期限チェック
    if (new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json({ error: '招待の有効期限が切れています' }, { status: 404 });
    }

    return NextResponse.json(invitation);
  } catch (e) {
    captureApiError(e, {
      route: 'GET /api/invite/[token]',
    });
    console.error('GET /api/invite/[token] error:', e);
    return NextResponse.json({ error: '招待情報の取得に失敗しました' }, { status: 500 });
  }
}
