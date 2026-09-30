import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { captureApiError } from '@/lib/api-error';
import { getApiAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { subscription, schoolId } = body as {
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
      schoolId: string;
    };

    if (
      !subscription?.endpoint ||
      !subscription?.keys?.p256dh ||
      !subscription?.keys?.auth ||
      !schoolId
    ) {
      return NextResponse.json({ error: '不正なリクエスト' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // ★通知を受け取る教室は、自分の担当教室に限る。push_subscriptions の RLS は user_id しか
    //   見ないため、以前は任意の教室IDで登録でき、他教室の「○○さんから申込」通知（生徒名入り）が
    //   届いた（2026-09-30 総点検）。
    const { auth } = await getApiAuth(request);
    if (!auth || auth.userId !== user.id || !auth.schoolIds.includes(schoolId)) {
      return NextResponse.json({ error: 'この教室の通知は登録できません' }, { status: 403 });
    }

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        school_id: schoolId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      { onConflict: 'user_id,endpoint' }
    );

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    captureApiError(e, {
      route: 'POST /api/push/subscribe',
    });
    console.error('[push/subscribe]', e);
    return NextResponse.json({ error: '登録に失敗しました' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { endpoint } = body as { endpoint: string };

    if (!endpoint) {
      return NextResponse.json({ error: '不正なリクエスト' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint);

    return NextResponse.json({ ok: true });
  } catch (e) {
    captureApiError(e, {
      route: 'DELETE /api/push/subscribe',
    });
    console.error('[push/unsubscribe]', e);
    return NextResponse.json({ error: '解除に失敗しました' }, { status: 500 });
  }
}
