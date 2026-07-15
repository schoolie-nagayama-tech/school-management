import { NextResponse } from 'next/server';
import { clearPortalSession } from '@/lib/mypage/session';

export const dynamic = 'force-dynamic';

/**
 * デモ用ポータルセッションの終了（スタッフ画面に戻る）。
 *
 * 認証を要求しない理由:
 *   やることは自分の cookie を消すだけで、他人に影響しない。
 *   ここに認証を課すと「セッションが壊れて抜けられない」状態を作るだけなので、
 *   常に抜けられる出口にしておく（ログアウトと同じ考え方）。
 */
export async function POST() {
  await clearPortalSession();
  return NextResponse.json({ ok: true });
}
