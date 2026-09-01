import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import { captureApiError } from '@/lib/api-error';

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
 * GET /api/embed/applications?token=xxx
 * 埋め込みウィジェット用: トークンで認証し申込状況データを返す
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'トークンが必要です' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // トークン検証
    const { data: tokenData, error: tokenError } = await supabase
      .from('embed_tokens')
      .select('*')
      .eq('token', token)
      .eq('is_active', true)
      .eq('embed_type', 'applications')
      .single();

    if (tokenError || !tokenData) {
      return NextResponse.json({ error: '無効なトークンです' }, { status: 403 });
    }

    const schoolId = tokenData.school_id;

    // 生徒取得（退会除外）。大型校では 1000 名を超えうるため全件ページング取得。
    // grade/last_name_kana は一意でないので id を最終ソートキーに加えて安定化する。
    let students: Record<string, unknown>[];
    try {
      students = await fetchAllPaged<Record<string, unknown>>((from, to) =>
        supabase
          .from('students')
          .select('id, last_name, first_name, grade, status')
          .eq('school_id', schoolId)
          .is('deleted_at', null)
          .neq('status', 'withdrawn')
          .order('grade')
          .order('last_name_kana')
          .order('id', { ascending: true })
          .range(from, to)
      );
    } catch (studentsError) {
      captureApiError(studentsError, {
        route: 'GET /api/embed/applications',
      });
      console.error('Error fetching students:', studentsError);
      return NextResponse.json({ error: '生徒データの取得に失敗しました' }, { status: 500 });
    }

    // 申込項目取得（非表示除外）
    const { data: items, error: itemsError } = await supabase
      .from('application_items')
      .select('*')
      .eq('school_id', schoolId)
      .eq('is_hidden', false)
      .order('sort_order');

    if (itemsError) {
      console.error('Error fetching items:', itemsError);
      return NextResponse.json({ error: '申込項目の取得に失敗しました' }, { status: 500 });
    }

    // 申込状況取得。(生徒数 × 項目数) でスケールし容易に 1000 行を超えるため全件ページング取得。
    let applications: Record<string, unknown>[];
    try {
      applications = await fetchAllPaged<Record<string, unknown>>((from, to) =>
        supabase
          .from('student_applications')
          .select('*')
          .eq('school_id', schoolId)
          .order('id', { ascending: true })
          .range(from, to)
      );
    } catch (appsError) {
      captureApiError(appsError, {
        route: 'GET /api/embed/applications',
      });
      console.error('Error fetching applications:', appsError);
      return NextResponse.json({ error: '申込状況の取得に失敗しました' }, { status: 500 });
    }

    // 教室名取得
    const { data: school } = await supabase
      .from('schools')
      .select('name')
      .eq('id', schoolId)
      .single();

    return NextResponse.json({
      school_name: school?.name || '',
      students: students || [],
      items: items || [],
      applications: applications || [],
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    captureApiError(error, {
      route: 'GET /api/embed/applications',
    });
    console.error('Embed API error:', error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

/**
 * POST /api/embed/applications
 * 埋め込みウィジェットから申込状況を更新する
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, student_id, item_id, action, value } = body as {
      token?: string;
      student_id?: string;
      item_id?: string;
      action?: 'status' | 'number' | 'date';
      value?: string | number | null;
    };

    if (!token || !student_id || !item_id || !action) {
      return NextResponse.json({ error: 'パラメータが不足しています' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // トークン検証
    const { data: tokenData, error: tokenError } = await supabase
      .from('embed_tokens')
      .select('*')
      .eq('token', token)
      .eq('is_active', true)
      .eq('embed_type', 'applications')
      .single();

    if (tokenError || !tokenData) {
      return NextResponse.json({ error: '無効なトークンです' }, { status: 403 });
    }

    const schoolId = tokenData.school_id;

    // 生徒がこの教室に属するか確認
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('id')
      .eq('id', student_id)
      .eq('school_id', schoolId)
      .is('deleted_at', null)
      .single();

    if (studentError || !student) {
      return NextResponse.json({ error: '生徒が見つかりません' }, { status: 404 });
    }

    // 既存レコード確認
    const { data: existing } = await supabase
      .from('student_applications')
      .select('id, status, number_value, date_value')
      .eq('student_id', student_id)
      .eq('item_id', item_id)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (action === 'status') {
      const status = value as string | null;

      if (status === null) {
        // 削除
        if (existing) {
          await supabase.from('student_applications').delete().eq('id', existing.id);
        }
        return NextResponse.json({ success: true, status: null });
      }

      if (existing) {
        const { data, error: updateError } = await supabase
          .from('student_applications')
          .update({ status })
          .eq('id', existing.id)
          .select()
          .single();
        if (updateError) {
          return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
        }
        return NextResponse.json({ success: true, application: data });
      } else {
        const { data, error: insertError } = await supabase
          .from('student_applications')
          .insert({ school_id: schoolId, student_id, item_id, status })
          .select()
          .single();
        if (insertError) {
          return NextResponse.json({ error: '作成に失敗しました' }, { status: 500 });
        }
        return NextResponse.json({ success: true, application: data });
      }
    }

    if (action === 'number') {
      const numberValue = value as number | null;

      if (numberValue === null && existing) {
        await supabase.from('student_applications').delete().eq('id', existing.id);
        return NextResponse.json({ success: true });
      }

      if (existing) {
        const { data, error: updateError } = await supabase
          .from('student_applications')
          .update({ number_value: numberValue })
          .eq('id', existing.id)
          .select()
          .single();
        if (updateError) {
          return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
        }
        return NextResponse.json({ success: true, application: data });
      } else {
        const { data, error: insertError } = await supabase
          .from('student_applications')
          .insert({ school_id: schoolId, student_id, item_id, number_value: numberValue })
          .select()
          .single();
        if (insertError) {
          return NextResponse.json({ error: '作成に失敗しました' }, { status: 500 });
        }
        return NextResponse.json({ success: true, application: data });
      }
    }

    if (action === 'date') {
      const dateValue = value as string | null;

      if (dateValue === null && existing) {
        await supabase.from('student_applications').delete().eq('id', existing.id);
        return NextResponse.json({ success: true });
      }

      if (existing) {
        const { data, error: updateError } = await supabase
          .from('student_applications')
          .update({ date_value: dateValue })
          .eq('id', existing.id)
          .select()
          .single();
        if (updateError) {
          return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
        }
        return NextResponse.json({ success: true, application: data });
      } else {
        const { data, error: insertError } = await supabase
          .from('student_applications')
          .insert({ school_id: schoolId, student_id, item_id, date_value: dateValue })
          .select()
          .single();
        if (insertError) {
          return NextResponse.json({ error: '作成に失敗しました' }, { status: 500 });
        }
        return NextResponse.json({ success: true, application: data });
      }
    }

    return NextResponse.json({ error: '不明なアクションです' }, { status: 400 });
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/embed/applications',
    });
    console.error('Embed POST error:', error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
