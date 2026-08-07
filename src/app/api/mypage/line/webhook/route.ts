import { NextRequest, NextResponse } from 'next/server';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { parseLineEvents, verifyLineSignature } from '@/lib/mypage/lineWebhook';

export const dynamic = 'force-dynamic';

/**
 * LINE Messaging API の webhook 受け口（P3-C9）。
 *
 * 役割は「友だち状態の同期」だけに絞る:
 *   - follow   … 友だち追加 or ブロック解除 → line_followed = true
 *   - unfollow … ブロック or 友だち削除     → line_followed = false
 *   これにより push の宛先から「届かない相手」を外せる（無駄打ち・無駄な通数を防ぐ）。
 *
 * ★ 署名検証に失敗したら何もせず 401:
 *   このURLは公開エンドポイントで誰でもPOSTできる。検証を通らないリクエストは
 *   本文のパースすらしない（他人のユーザーIDで unfollow を偽装して通知を止める、
 *   といった改ざんを成立させないため）。
 *
 * ★ 常に 200 を返す（署名不正を除く）:
 *   LINE は 2xx 以外が続くと webhook を自動停止する。個々のイベント処理の失敗で
 *   受け口ごと止まる方が損害が大きいので、処理エラーはログに残して 200 を返す。
 *
 * メッセージイベントは現状ハンドルしない:
 *   保護者との対話はアプリ内チャット（P3-C1/C2）が正典で、LINEトーク上での
 *   会話は受け付けない方針（設計 §9 ④）。将来必要になったらここに足す。
 */
export async function POST(request: NextRequest) {
  // ★ 署名は「生のボディ」に対して計算されている。JSONにしてから戻すと一致しないので
  //   必ず text() で読み、以降のパースもこの文字列から行う。
  const rawBody = await request.text();
  const signature = request.headers.get('x-line-signature');

  if (!verifyLineSignature(rawBody, signature)) {
    console.warn('[mypage/line/webhook] 署名検証に失敗したリクエストを拒否しました');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const events = parseLineEvents(rawBody);
  // 接続確認（コンソールの「検証」ボタン）は events が空。200 を返すだけでよい。
  if (events.length === 0) {
    return NextResponse.json({ ok: true });
  }

  try {
    const supabase = getPortalServiceClient();

    for (const ev of events) {
      if (!ev.userId) continue;
      if (ev.type !== 'follow' && ev.type !== 'unfollow') continue;

      const followed = ev.type === 'follow';
      const { error } = await supabase
        .from('portal_accounts')
        .update({
          line_followed: followed,
          line_follow_updated_at: new Date().toISOString(),
        })
        .eq('line_user_id', ev.userId);

      if (error) {
        console.warn('[mypage/line/webhook] 友だち状態の更新に失敗:', error.message);
      }
      // 該当アカウントが無い場合（ポータル未登録の友だち）は何もしない。
      // 先に友だち追加してから後日ログインする順序も普通にあるため、これは異常ではない。
    }
  } catch (e) {
    // 受け口を止めないため、処理エラーでも 200 を返す（上のコメント参照）。
    console.error('[mypage/line/webhook] イベント処理に失敗:', e);
  }

  return NextResponse.json({ ok: true });
}
