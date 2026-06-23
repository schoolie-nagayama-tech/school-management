import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getApiAuth, isSchoolInScope } from '@/lib/api-auth';

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

export async function POST(request: NextRequest) {
  try {
    const { auth } = await getApiAuth(request);
    if (!auth) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    const role = auth.role.toLowerCase();
    if (role !== 'admin' && role !== 'owner' && role !== 'manager') {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }

    const body = await request.json();
    const { type, submissionId } = body as {
      type?: 'submitted' | 'allow_edit';
      submissionId?: string;
    };

    if (!type || !submissionId) {
      return NextResponse.json({ error: 'type and submissionId are required' }, { status: 400 });
    }
    if (type !== 'submitted' && type !== 'allow_edit') {
      return NextResponse.json({ error: 'type must be submitted or allow_edit' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 対象 submission が呼び出し元の教室スコープ内かを検証する。
    // service role は RLS を無視するため、ここで school 所属を確認しないと
    // 他教室の submission の通知（講師宛メール等）を勝手にトリガーできてしまう。
    // admin/owner は schoolIds に全教室が入るため isSchoolInScope は常に true。
    const { data: submission, error: subError } = await supabaseAdmin
      .from('seasonal_shift_submissions')
      .select('school_id')
      .eq('id', submissionId)
      .maybeSingle();
    if (subError || !submission) {
      return NextResponse.json({ error: '提出が見つかりません' }, { status: 404 });
    }
    if (!isSchoolInScope(String(submission.school_id), auth.schoolIds)) {
      console.error(
        JSON.stringify({
          type: 'SCOPE_VIOLATION',
          actorId: auth.userId,
          path: request.nextUrl.pathname,
          submissionId,
          timestamp: new Date().toISOString(),
        })
      );
      return NextResponse.json({ error: '提出が見つかりません' }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin.functions.invoke('send-form-notification', {
      body: {
        notificationType: 'seasonal-shift',
        type,
        submissionId,
      },
    });

    if (error) {
      console.error('[seasonal-shift/notify] Edge Function error:', error);
      return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
    }
    if (data && typeof data === 'object' && 'error' in data) {
      console.error(
        '[seasonal-shift/notify] Edge Function returned error:',
        (data as { error: string }).error
      );
      return NextResponse.json({ error: (data as { error: string }).error }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[seasonal-shift/notify]', e);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
