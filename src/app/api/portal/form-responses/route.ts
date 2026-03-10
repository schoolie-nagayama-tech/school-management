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
 * 保護者ポータル用フォーム回答送信エンドポイント（認証不要）
 * サービスロールキーで RLS をバイパスして form_responses に挿入する
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      school_id,
      form_type,
      form_period,
      student_name,
      grade,
      email,
      response_data,
      status_checks,
    } = body as {
      school_id?: string;
      form_type?: string;
      form_period?: string;
      student_name?: string;
      grade?: number;
      email?: string;
      response_data?: unknown;
      status_checks?: unknown;
    };

    if (!school_id || !form_type || !form_period || !student_name || !email) {
      return NextResponse.json(
        { error: 'school_id, form_type, form_period, student_name, email は必須です' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // フォーム公開期間が有効かチェック
    const { data: period, error: periodError } = await supabaseAdmin
      .from('form_periods')
      .select('id, is_active, is_archived, publish_start, publish_end')
      .eq('school_id', school_id)
      .eq('form_type', form_type)
      .eq('period_key', form_period)
      .maybeSingle();

    if (periodError) {
      throw periodError;
    }

    if (!period || !period.is_active || period.is_archived) {
      return NextResponse.json({ error: '現在受付していません' }, { status: 400 });
    }

    const now = new Date();
    if (period.publish_start && new Date(period.publish_start) > now) {
      return NextResponse.json({ error: '現在受付していません' }, { status: 400 });
    }
    if (period.publish_end && new Date(period.publish_end) < now) {
      return NextResponse.json({ error: '受付期間が終了しました' }, { status: 400 });
    }

    const { data: created, error } = await supabaseAdmin
      .from('form_responses')
      .insert({
        school_id,
        form_type,
        form_period,
        student_name,
        grade,
        email,
        response_data,
        status_checks,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'この内容は既に送信されています。' },
          { status: 409 }
        );
      }
      throw error;
    }

    // 申込通知メール送信（失敗しても回答は成功扱い）
    try {
      const { error: invokeError } = await supabaseAdmin.functions.invoke(
        'send-form-notification',
        { body: { record: created } }
      );
      if (invokeError) {
        console.warn('[portal/form-responses] 申込通知メールの送信に失敗しました:', invokeError);
      }
    } catch (e) {
      console.warn('[portal/form-responses] 申込通知メールの送信に失敗しました:', e);
    }

    return NextResponse.json({ data: created });
  } catch (error) {
    console.error('[portal/form-responses] create failed:', error);
    return NextResponse.json(
      { error: 'フォーム回答の作成に失敗しました' },
      { status: 500 }
    );
  }
}
