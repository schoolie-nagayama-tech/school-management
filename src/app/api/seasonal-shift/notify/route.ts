import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireManager } from '@/lib/api-auth';

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
    const authError = await requireManager(request);
    if (authError) return authError;

    const body = await request.json();
    const { type, submissionId } = body as {
      type?: 'submitted' | 'allow_edit';
      submissionId?: string;
    };

    if (!type || !submissionId) {
      return NextResponse.json(
        { error: 'type Ç∆ submissionId ÇÕïKê{Ç≈Ç∑' },
        { status: 400 }
      );
    }
    if (type !== 'submitted' && type !== 'allow_edit') {
      return NextResponse.json(
        { error: 'type ÇÕ submitted Ç‹ÇΩÇÕ allow_edit Ç≈Ç∑' },
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
        { error: 'í ímÇÃëóêMÇ…é∏îsÇµÇ‹ÇµÇΩ' },
        { status: 500 }
      );
    }
    if (data && typeof data === 'object' && 'error' in data) {
      console.error(
        '[seasonal-shift/notify] Edge Function returned error:',
        (data as { error: string }).error
      );
      return NextResponse.json(
        { error: (data as { error: string }).error },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[seasonal-shift/notify]', e);
    return NextResponse.json(
      { error: 'í ímÇÃëóêMÇ…é∏îsÇµÇ‹ÇµÇΩ' },
      { status: 500 }
    );
  }
}
