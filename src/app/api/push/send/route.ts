import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: NextRequest) {
  // 内部呼び出しのみ許可（同一オリジンまたはサービスロールキーによるヘッダー確認）
  const internalKey = request.headers.get('x-internal-key');
  if (internalKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { schoolId, title, bodyText, url } = body as {
      schoolId: string;
      title: string;
      bodyText: string;
      url: string;
    };

    if (!schoolId || !title) {
      return NextResponse.json({ error: '不正なリクエスト' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: subscriptions, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('school_id', schoolId);

    if (error) throw error;
    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ sent: 0 });
    }

    // web-push をハンドラ内で遅延ロード（ビルド時のモジュール解決エラーを回避）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const webpush = require('web-push') as typeof import('web-push');
    webpush.setVapidDetails(
      'mailto:' + (process.env.VAPID_MAILTO ?? 'admin@example.com'),
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );

    const payload = JSON.stringify({ title, body: bodyText, url });
    let sent = 0;
    const stale: string[] = [];

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload
          );
          sent++;
        } catch (err: unknown) {
          // 410 Gone = 期限切れサブスクリプション → 削除対象
          if (
            err &&
            typeof err === 'object' &&
            'statusCode' in err &&
            (err as { statusCode: number }).statusCode === 410
          ) {
            stale.push(sub.endpoint);
          } else {
            // 410（期限切れ）は正常な後始末なので送らない。それ以外だけ Sentry へ。
            captureApiError(err, {
              route: 'POST /api/push/send',
              action: 'send_notification',
            });
            console.warn('[push/send] 送信失敗:', err);
          }
        }
      })
    );

    // 期限切れサブスクリプションを削除
    if (stale.length > 0) {
      await supabaseAdmin.from('push_subscriptions').delete().in('endpoint', stale);
    }

    return NextResponse.json({ sent });
  } catch (e) {
    captureApiError(e, {
      route: 'POST /api/push/send',
    });
    console.error('[push/send]', e);
    return NextResponse.json({ error: '送信に失敗しました' }, { status: 500 });
  }
}
