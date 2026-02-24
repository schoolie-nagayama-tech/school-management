import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
 * 講習シフト通知メールを送信する Edge Function をサーバーから呼び出す。
 * ブラウザの anon クライアントで invoke すると JWT 検証で 401 になるため、
 * サーバー（サービスロール）経由で呼ぶ。
 * 講師提出フォームは公開ページのため認証不要。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, submissionId } = body as {
      type?: 'submitted' | 'allow_edit';
      submissionId?: string;
    };

    if (!type || !submissionId) {
      return NextResponse.json(
        { error: 'type と submissionId は必須です' },
        { status: 400 }
      );
    }
    if (type !== 'submitted' && type !== 'allow_edit') {
      return NextResponse.json(
        { error: 'type は submitted または allow_edit です' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin.functions.invoke(
      'send-form-notification',
      {
        body: {
          notificationType: 'seasonal-shift',
          type,
          submissionId,
        },
      }
    );

    if (error) {
      console.error('[seasonal-shift/notify] Edge Function error:', error);
      return NextResponse.json(
        { error: '通知の送信に失敗しました' },
        { status: 500 }
      );
    }
    if (data && typeof data === 'object' && 'error' in data) {
      console.error('[seasonal-shift/notify] Edge Function returned error:', (data as { error: string }).error);
      return NextResponse.json(
        { error: (data as { error: string }).error },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[seasonal-shift/notify]', e);
    return NextResponse.json(
      { error: '通知の送信に失敗しました' },
      { status: 500 }
    );
  }
}
