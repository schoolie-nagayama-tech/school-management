import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Vercel Cron からの呼び出しであることを検証する。
 *
 * ★フェイルクローズド: CRON_SECRET が未設定なら「認証できない」として必ず 401 を返す。
 *   以前は `if (CRON_SECRET && authHeader !== ...)` と書かれており、環境変数の設定漏れ・
 *   削除で条件全体が false になり、URL を知る第三者が誰でも cron を叩ける状態だった
 *   （withdraw-expired-students は生徒ステータスを一括で退塾に変える破壊的処理）。
 *   このプロジェクトの他のフラグ（LINE_PUSH_ENABLED / MAINTENANCE_MODE / 通知許可リスト）は
 *   すべて「未設定なら安全側」で統一されているので、認証系もそれに揃える。
 *
 * @returns 認証NGなら 401 の NextResponse、OKなら null（処理続行）
 */
export function requireCronAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron] CRON_SECRET が未設定のため実行を拒否しました');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader || !safeCompare(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

/**
 * 定数時間比較。`a === b` だと先頭何文字が一致したかが実行時間に出るため、
 * シークレットの突き合わせには使わない。長さが違う場合も早期 return せず
 * ダミー比較を挟んで時間差を作らない。
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // 長さが違っても同サイズ同士で比較を走らせ、早期 return による時間差を作らない
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
