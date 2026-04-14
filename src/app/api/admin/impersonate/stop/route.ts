import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * アカウントスイッチから元のアカウントに戻る
 * Cookie から保存しておいた admin の refresh_token を取り出してクライアントに返す
 * クライアントは supabase.auth.refreshSession({ refresh_token }) で元セッションを復元する
 */
export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get('impersonator_refresh_token')?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: '元の管理者セッションが見つかりません' }, { status: 400 });
  }

  const res = NextResponse.json({ refreshToken });
  // cookie を削除
  res.cookies.set('impersonator_refresh_token', '', { path: '/', maxAge: 0 });
  res.cookies.set('impersonator_user_id', '', { path: '/', maxAge: 0 });
  return res;
}
