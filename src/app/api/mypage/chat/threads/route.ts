import { NextResponse } from 'next/server';
import { getPortalContext } from '@/lib/mypage/supabase';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { getPortalChatSummaries } from '@/lib/mypage/chatSummary';

export const dynamic = 'force-dynamic';

/**
 * 保護者チャット: 自分の紐づけ生徒ごとのスレッド概要一覧。
 *
 * ★ 本体は lib/mypage/chatSummary.ts の getPortalChatSummaries に切り出した。
 *   ダッシュボード（app/mypage/page.tsx）も同じ処理を使うため、ここは
 *   認証（getPortalContext）と service role クライアントの用意だけを持つ。
 */
export async function GET() {
  const ctx = await getPortalContext();
  if (!ctx) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const svc = getPortalServiceClient();
  const summaries = await getPortalChatSummaries(ctx.client, svc, ctx.claims.sub);

  return NextResponse.json({ threads: summaries });
}
