import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getApiAuth } from '@/lib/api-auth';

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
 * 認証チェック: 既存の getApiAuth を使って認証＋school_id アクセス権を検証
 * admin/owner は全教室アクセス可能
 */
async function authenticateAndAuthorize(request: NextRequest, schoolId: string) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return { error: '認証が必要です', status: 401 };
  }

  // schoolIds には admin/owner の場合は全教室が入っている
  if (!auth.schoolIds.includes(schoolId)) {
    return { error: 'この教室へのアクセス権がありません', status: 403 };
  }

  const supabaseAdmin = getSupabaseAdmin();
  return { user: auth, supabaseAdmin };
}

/**
 * GET /api/courses/prep?action=...&schoolId=...&season=...&year=...
 *
 * サービスロールキーで RLS をバイパスして講習準備データを読み取る
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const schoolId = url.searchParams.get('schoolId');

    if (!action || !schoolId) {
      return NextResponse.json({ error: 'action と schoolId が必要です' }, { status: 400 });
    }

    const authResult = await authenticateAndAuthorize(request, schoolId);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const { supabaseAdmin } = authResult;

    const season = url.searchParams.get('season') || '';
    const year = parseInt(url.searchParams.get('year') || '0', 10);
    const includeHidden = url.searchParams.get('includeHidden') === 'true';

    switch (action) {
      case 'get_progress_items': {
        let query = supabaseAdmin
          .from('course_prep_progress_items')
          .select('*')
          .eq('school_id', schoolId)
          .eq('season', season)
          .eq('year', year)
          .order('sort_order', { ascending: true });

        if (!includeHidden) {
          query = query.or('is_hidden.eq.false,is_hidden.is.null');
        }

        const { data, error } = await query;
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ data: data || [] });
      }

      case 'get_student_progress': {
        // まず該当期間の項目IDを取得
        const { data: items } = await supabaseAdmin
          .from('course_prep_progress_items')
          .select('id')
          .eq('school_id', schoolId)
          .eq('season', season)
          .eq('year', year);

        if (!items || items.length === 0) {
          return NextResponse.json({ data: [] });
        }

        const itemIds = items.map((i: { id: string }) => i.id);
        const { data, error } = await supabaseAdmin
          .from('course_prep_student_progress')
          .select('*')
          .eq('school_id', schoolId)
          .in('item_id', itemIds);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ data: data || [] });
      }

      case 'get_period': {
        const { data, error } = await supabaseAdmin
          .from('course_prep_periods')
          .select('*')
          .eq('school_id', schoolId)
          .eq('season', season)
          .eq('year', year)
          .maybeSingle();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ data });
      }

      case 'get_templates': {
        const templateType = url.searchParams.get('templateType') || undefined;
        let query = supabaseAdmin
          .from('course_prep_templates')
          .select('*')
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: false });

        if (templateType) {
          query = query.eq('template_type', templateType);
        }
        if (season) {
          query = query.or(`season.eq.${season},season.is.null`);
        }

        const { data, error } = await query;
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ data: data || [] });
      }

      case 'get_schedule_tasks': {
        const { data: tasks, error } = await supabaseAdmin
          .from('course_prep_schedule_tasks')
          .select('*')
          .eq('school_id', schoolId)
          .eq('season', season)
          .eq('year', year)
          .order('sort_order', { ascending: true });

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!tasks || tasks.length === 0) return NextResponse.json({ data: [] });

        const taskIds = tasks.map((t: { id: string }) => t.id);
        const { data: markers } = await supabaseAdmin
          .from('course_prep_schedule_markers')
          .select('*')
          .in('task_id', taskIds)
          .order('marker_date', { ascending: true });

        const markersByTask = new Map<string, unknown[]>();
        for (const m of (markers || [])) {
          const tid = (m as { task_id: string }).task_id;
          if (!markersByTask.has(tid)) markersByTask.set(tid, []);
          markersByTask.get(tid)!.push(m);
        }

        const result = tasks.map((t: { id: string }) => ({
          ...t,
          markers: markersByTask.get(t.id) || [],
        }));

        return NextResponse.json({ data: result });
      }

      default:
        return NextResponse.json({ error: `不明なアクション: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('[courses/prep GET] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '取得に失敗しました' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/courses/prep
 *
 * サービスロールキーで RLS をバイパスして講習準備データを操作する
 *
 * body.action:
 *   - "init_progress_template" : テンプレートから進捗管理項目を初期化
 *   - "init_schedule_template" : テンプレートから工程表タスクを初期化
 *   - "create_progress_item"   : 進捗管理項目を追加
 *   - "update_student_progress": 生徒の進捗を更新
 *   - "update_student_number"  : 生徒の数値データを更新
 *   - "update_student_date"    : 生徒の日付データを更新
 *   - "hide_progress_item"     : 進捗管理項目を非表示
 *   - "delete_progress_item"   : 進捗管理項目を削除
 *   - "create_schedule_task"   : 工程表タスクを追加
 *   - "update_schedule_task"   : 工程表タスクを更新
 *   - "delete_schedule_task"   : 工程表タスクを削除
 *   - "upsert_schedule_marker" : 工程表マーカーを追加/更新
 *   - "delete_schedule_marker" : 工程表マーカーを削除
 *   - "upsert_period"          : 講習期間メタを更新
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, schoolId, ...params } = body;

    if (!action || !schoolId) {
      return NextResponse.json({ error: 'action と schoolId が必要です' }, { status: 400 });
    }

    const authResult = await authenticateAndAuthorize(request, schoolId);
    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const { supabaseAdmin } = authResult;

    switch (action) {
      case 'init_progress_template':
        return await handleInitProgressTemplate(supabaseAdmin, schoolId, params);
      case 'init_schedule_template':
        return await handleInitScheduleTemplate(supabaseAdmin, schoolId, params);
      case 'create_progress_item':
        return await handleCreateProgressItem(supabaseAdmin, schoolId, params);
      case 'update_student_progress':
        return await handleUpdateStudentProgress(supabaseAdmin, params);
      case 'update_student_number':
        return await handleUpdateStudentNumber(supabaseAdmin, params);
      case 'update_student_date':
        return await handleUpdateStudentDate(supabaseAdmin, params);
      case 'hide_progress_item':
        return await handleHideProgressItem(supabaseAdmin, params);
      case 'delete_progress_item':
        return await handleDeleteProgressItem(supabaseAdmin, params);
      case 'create_schedule_task':
        return await handleCreateScheduleTask(supabaseAdmin, schoolId, params);
      case 'update_schedule_task':
        return await handleUpdateScheduleTask(supabaseAdmin, params);
      case 'delete_schedule_task':
        return await handleDeleteScheduleTask(supabaseAdmin, params);
      case 'save_template':
        return await handleSaveTemplate(supabaseAdmin, schoolId, params);
      case 'delete_template':
        return await handleDeleteTemplate(supabaseAdmin, params);
      case 'delete_all_progress_items':
        return await handleDeleteAllProgressItems(supabaseAdmin, schoolId, params);
      case 'upsert_schedule_marker':
        return await handleUpsertScheduleMarker(supabaseAdmin, params);
      case 'delete_schedule_marker':
        return await handleDeleteScheduleMarker(supabaseAdmin, params);
      case 'upsert_period':
        return await handleUpsertPeriod(supabaseAdmin, schoolId, params);
      default:
        return NextResponse.json({ error: `不明なアクション: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('[courses/prep] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '操作に失敗しました' },
      { status: 500 }
    );
  }
}

// ===== テンプレート初期化 =====

async function handleInitProgressTemplate(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { season: string; year: number; templateId: string }
) {
  const { season, year, templateId } = params;

  const { data: template, error: tErr } = await supabaseAdmin
    .from('course_prep_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (tErr || !template) {
    return NextResponse.json({ error: 'テンプレートが見つかりません' }, { status: 404 });
  }

  const items = (template as { template_data: Array<{ name: string; column_type: string; sort_order: number; column_group?: string }> }).template_data;
  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'テンプレートに項目がありません' }, { status: 400 });
  }

  // 既存項目を削除してから挿入（再適用対応）
  await supabaseAdmin
    .from('course_prep_progress_items')
    .delete()
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year);

  const insertData = items.map((item) => ({
    school_id: schoolId,
    season,
    year,
    name: item.name,
    column_type: item.column_type || 'check',
    sort_order: item.sort_order,
  }));

  const { error: insertError } = await supabaseAdmin
    .from('course_prep_progress_items')
    .insert(insertData);

  if (insertError) {
    return NextResponse.json({ error: `適用失敗: ${insertError.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, count: insertData.length });
}

async function handleInitScheduleTemplate(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { season: string; year: number; templateId: string }
) {
  const { season, year, templateId } = params;

  const { data: template, error: tErr } = await supabaseAdmin
    .from('course_prep_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (tErr || !template) {
    return NextResponse.json({ error: 'テンプレートが見つかりません' }, { status: 404 });
  }

  const tasks = (template as { template_data: Array<{ major_category: string; name: string; description?: string; sort_order: number }> }).template_data;
  if (!tasks || tasks.length === 0) {
    return NextResponse.json({ error: 'テンプレートにタスクがありません' }, { status: 400 });
  }

  // 既存タスクを削除してから挿入（再適用対応）
  await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .delete()
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year);

  const insertData = tasks.map((task) => ({
    school_id: schoolId,
    season,
    year,
    major_category: task.major_category,
    name: task.name,
    description: task.description || null,
    sort_order: task.sort_order,
  }));

  const { error: insertError } = await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .insert(insertData);

  if (insertError) {
    return NextResponse.json({ error: `適用失敗: ${insertError.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, count: insertData.length });
}

// ===== 進捗管理項目 =====

async function handleCreateProgressItem(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { season: string; year: number; name: string; columnType: string; sortOrder: number }
) {
  const { season, year, name, columnType, sortOrder } = params;

  const { data, error } = await supabaseAdmin
    .from('course_prep_progress_items')
    .insert({
      school_id: schoolId,
      season,
      year,
      name,
      column_type: columnType || 'check',
      sort_order: sortOrder,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

async function handleHideProgressItem(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { itemId: string; isHidden: boolean }
) {
  const { error } = await supabaseAdmin
    .from('course_prep_progress_items')
    .update({ is_hidden: params.isHidden })
    .eq('id', params.itemId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

async function handleDeleteProgressItem(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { itemId: string }
) {
  const { error } = await supabaseAdmin
    .from('course_prep_progress_items')
    .delete()
    .eq('id', params.itemId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// ===== 生徒進捗 =====

async function handleUpdateStudentProgress(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { schoolId: string; studentId: string; itemId: string; status: string }
) {
  const { schoolId, studentId, itemId, status } = params;

  const { data: existing } = await supabaseAdmin
    .from('course_prep_student_progress')
    .select('id')
    .eq('student_id', studentId)
    .eq('item_id', itemId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseAdmin
      .from('course_prep_student_progress')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabaseAdmin
      .from('course_prep_student_progress')
      .insert({ school_id: schoolId, student_id: studentId, item_id: itemId, status });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

async function handleUpdateStudentNumber(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { schoolId: string; studentId: string; itemId: string; numberValue: number | null }
) {
  const { schoolId, studentId, itemId, numberValue } = params;

  const { data: existing } = await supabaseAdmin
    .from('course_prep_student_progress')
    .select('id')
    .eq('student_id', studentId)
    .eq('item_id', itemId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseAdmin
      .from('course_prep_student_progress')
      .update({ number_value: numberValue, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabaseAdmin
      .from('course_prep_student_progress')
      .insert({ school_id: schoolId, student_id: studentId, item_id: itemId, number_value: numberValue });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

async function handleUpdateStudentDate(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { schoolId: string; studentId: string; itemId: string; dateValue: string | null }
) {
  const { schoolId, studentId, itemId, dateValue } = params;

  const { data: existing } = await supabaseAdmin
    .from('course_prep_student_progress')
    .select('id')
    .eq('student_id', studentId)
    .eq('item_id', itemId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseAdmin
      .from('course_prep_student_progress')
      .update({ date_value: dateValue, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabaseAdmin
      .from('course_prep_student_progress')
      .insert({ school_id: schoolId, student_id: studentId, item_id: itemId, date_value: dateValue });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// ===== 工程表タスク =====

async function handleCreateScheduleTask(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { season: string; year: number; majorCategory: string; name: string; description?: string; sortOrder: number }
) {
  const { data, error } = await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .insert({
      school_id: schoolId,
      season: params.season,
      year: params.year,
      major_category: params.majorCategory,
      name: params.name,
      description: params.description || null,
      sort_order: params.sortOrder,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

async function handleUpdateScheduleTask(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { taskId: string; updates: Record<string, unknown> }
) {
  const { error } = await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .update({ ...params.updates, updated_at: new Date().toISOString() })
    .eq('id', params.taskId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

async function handleDeleteScheduleTask(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { taskId: string }
) {
  const { error } = await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .delete()
    .eq('id', params.taskId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// ===== 工程表マーカー =====

async function handleUpsertScheduleMarker(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { taskId: string; markerDate: string; label: string; color?: string }
) {
  const { data: existing } = await supabaseAdmin
    .from('course_prep_schedule_markers')
    .select('id')
    .eq('task_id', params.taskId)
    .eq('marker_date', params.markerDate)
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseAdmin
      .from('course_prep_schedule_markers')
      .update({ label: params.label, color: params.color || null, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabaseAdmin
      .from('course_prep_schedule_markers')
      .insert({
        task_id: params.taskId,
        marker_date: params.markerDate,
        label: params.label,
        color: params.color || null,
      });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

async function handleDeleteScheduleMarker(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { taskId: string; markerDate: string }
) {
  const { error } = await supabaseAdmin
    .from('course_prep_schedule_markers')
    .delete()
    .eq('task_id', params.taskId)
    .eq('marker_date', params.markerDate);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// ===== テンプレート =====

async function handleSaveTemplate(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { season: string; year: number; templateType: string; name: string }
) {
  const { season, year, templateType, name } = params;
  let templateData: Record<string, unknown>[];

  if (templateType === 'progress') {
    const { data, error } = await supabaseAdmin
      .from('course_prep_progress_items')
      .select('name, column_type, sort_order')
      .eq('school_id', schoolId)
      .eq('season', season)
      .eq('year', year)
      .or('is_hidden.eq.false,is_hidden.is.null')
      .order('sort_order');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    templateData = (data || []) as Record<string, unknown>[];
  } else {
    const { data, error } = await supabaseAdmin
      .from('course_prep_schedule_tasks')
      .select('major_category, name, description, sort_order')
      .eq('school_id', schoolId)
      .eq('season', season)
      .eq('year', year)
      .order('sort_order');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    templateData = (data || []) as Record<string, unknown>[];
  }

  const { data, error } = await supabaseAdmin
    .from('course_prep_templates')
    .insert({
      school_id: schoolId,
      template_type: templateType,
      season,
      name,
      template_data: templateData,
      is_default: false,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

async function handleDeleteTemplate(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { templateId: string }
) {
  const { error } = await supabaseAdmin
    .from('course_prep_templates')
    .delete()
    .eq('id', params.templateId)
    .eq('is_default', false);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

async function handleDeleteAllProgressItems(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { season: string; year: number }
) {
  const { error } = await supabaseAdmin
    .from('course_prep_progress_items')
    .delete()
    .eq('school_id', schoolId)
    .eq('season', params.season)
    .eq('year', params.year);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// ===== 講習期間メタ =====

async function handleUpsertPeriod(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { season: string; year: number; budgetKoma?: number; scheduleStartDate?: string; scheduleEndDate?: string }
) {
  const { data: existing } = await supabaseAdmin
    .from('course_prep_periods')
    .select('id')
    .eq('school_id', schoolId)
    .eq('season', params.season)
    .eq('year', params.year)
    .maybeSingle();

  const updateData: Record<string, unknown> = {};
  if (params.budgetKoma !== undefined) updateData.budget_koma = params.budgetKoma;
  if (params.scheduleStartDate !== undefined) updateData.schedule_start_date = params.scheduleStartDate;
  if (params.scheduleEndDate !== undefined) updateData.schedule_end_date = params.scheduleEndDate;

  if (existing) {
    const { error } = await supabaseAdmin
      .from('course_prep_periods')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabaseAdmin
      .from('course_prep_periods')
      .insert({
        school_id: schoolId,
        season: params.season,
        year: params.year,
        ...updateData,
      });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
