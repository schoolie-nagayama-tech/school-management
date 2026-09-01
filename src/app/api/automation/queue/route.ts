/**
 * POST /api/automation/queue — 自動入力の「保留ジョブ」を投入する。
 *
 * NEST内のUIから、ログイン中ユーザーのトークン行に actions ペイロードを保存する。
 * 対象サイト上のローダー・ブックマークレットが /api/automation/pull で取得する。
 * クリップボードを使わずクロスオリジンにデータを渡すための受け渡し場所。
 *
 * 認証: requireManager（教室長以上・セッションCookie）。
 * body: { payload: { label?: string, actions: AutomationAction[] } }
 *
 * 事前にローダー・トークンが発行されている必要がある（未発行なら 409 で案内）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireManager, getApiAuth } from '@/lib/api-auth';
import { isValidAutomationPayload } from '@/lib/automation/actions';
import { captureApiError } from '@/lib/api-error';

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase env not set');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: NextRequest) {
  const authError = await requireManager(request);
  if (authError) return authError;

  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  const userId = auth.userId;

  let payload: unknown;
  try {
    const body = (await request.json()) as { payload?: unknown };
    payload = body.payload;
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/automation/queue',
      userId: auth.userId,
      role: auth.role,
    });
    return NextResponse.json({ error: 'リクエストの形式が不正です' }, { status: 400 });
  }

  if (!isValidAutomationPayload(payload)) {
    return NextResponse.json({ error: 'actions ペイロードが不正です' }, { status: 400 });
  }

  const serviceClient = getServiceClient();

  // ユーザーの有効トークンを取得（無ければローダー未発行）
  const { data: tokenRow, error: lookupError } = await serviceClient
    .from('automation_tokens')
    .select('id')
    .eq('created_by', userId)
    .eq('revoked', false)
    .maybeSingle();

  if (lookupError) {
    console.error('[automation/queue] lookup error:', lookupError);
    return NextResponse.json({ error: 'トークン照合に失敗しました' }, { status: 500 });
  }

  if (!tokenRow) {
    return NextResponse.json(
      {
        error: 'ローダーが未発行です。設定 > 自動入力ローダー で発行してください。',
        code: 'NO_TOKEN',
      },
      { status: 409 }
    );
  }

  // 保留ジョブを上書き保存（直近の1件のみ保持）
  const { error: updateError } = await serviceClient
    .from('automation_tokens')
    .update({ pending_payload: payload, pending_at: new Date().toISOString() })
    .eq('id', tokenRow.id);

  if (updateError) {
    console.error('[automation/queue] update error:', updateError);
    return NextResponse.json({ error: '保留ジョブの保存に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
