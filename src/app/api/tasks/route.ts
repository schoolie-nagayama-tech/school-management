import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getApiAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ===================== GET =====================

export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const supabaseAdmin = getSupabaseAdmin();

  try {
    switch (action) {
      case 'get_monthly_tasks': {
        const year = parseInt(url.searchParams.get('year') || '');
        const month = parseInt(url.searchParams.get('month') || '');
        if (!year || !month) {
          return NextResponse.json({ error: 'year, month は必須です' }, { status: 400 });
        }

        const { data: tasks, error } = await supabaseAdmin
          .from('monthly_tasks')
          .select('*')
          .eq('year', year)
          .eq('month', month)
          .order('task_date', { ascending: true })
          .order('sort_order', { ascending: true });

        if (error) throw error;

        // チェック情報を一括取得
        const taskIds = (tasks || []).map((t: { id: string }) => t.id);
        let checks: Array<Record<string, unknown>> = [];
        if (taskIds.length > 0) {
          const { data: checkData, error: checkError } = await supabaseAdmin
            .from('monthly_task_checks')
            .select('*')
            .in('task_id', taskIds);
          if (checkError) throw checkError;
          checks = checkData || [];
        }

        // タスクにチェック情報を付与
        const tasksWithChecks = (tasks || []).map((task: Record<string, unknown>) => ({
          ...task,
          checks: checks.filter((c) => c.task_id === task.id),
        }));

        return NextResponse.json({ data: tasksWithChecks });
      }

      case 'get_templates': {
        const { data, error } = await supabaseAdmin
          .from('monthly_task_templates')
          .select('*')
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: false });
        if (error) throw error;
        return NextResponse.json({ data: data || [] });
      }

      case 'get_overdue_summary': {
        // 今日以前の未完了タスクをカウント
        const today = new Date().toISOString().split('T')[0];
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        const { data: overdueTasks, error } = await supabaseAdmin
          .from('monthly_tasks')
          .select('id, task_date, task_name, category')
          .eq('year', currentYear)
          .eq('month', currentMonth)
          .lt('task_date', today);

        if (error) throw error;
        if (!overdueTasks || overdueTasks.length === 0) {
          return NextResponse.json({ data: { count: 0, tasks: [] } });
        }

        const taskIds = overdueTasks.map((t: { id: string }) => t.id);
        const { data: checks } = await supabaseAdmin
          .from('monthly_task_checks')
          .select('task_id, school_id, is_completed')
          .in('task_id', taskIds);

        // 全教室で完了済みのタスクを除外
        const schoolIds = auth.schoolIds;
        const incompleteTasks = overdueTasks.filter((task: { id: string }) => {
          const taskChecks = (checks || []).filter(
            (c: Record<string, unknown>) => c.task_id === task.id && schoolIds.includes(c.school_id as string)
          );
          // チェックがない、またはいずれかの教室が未完了
          return taskChecks.length === 0 || taskChecks.some((c: Record<string, unknown>) => !c.is_completed);
        });

        return NextResponse.json({
          data: { count: incompleteTasks.length, tasks: incompleteTasks },
        });
      }

      default:
        return NextResponse.json({ error: `不明なアクション: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('[api/tasks GET]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'サーバーエラー' },
      { status: 500 }
    );
  }
}

// ===================== POST =====================

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const body = await request.json();
  const { action } = body;
  const supabaseAdmin = getSupabaseAdmin();

  // manager 以上のみ編集可能
  const editableRoles = ['admin', 'owner', 'manager'];
  const canEdit = editableRoles.includes(auth.role);

  try {
    switch (action) {
      case 'create_task': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { year, month, task_date, category, task_name, sort_order } = body;
        if (!year || !month || !task_date || !category || !task_name) {
          return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from('monthly_tasks')
          .insert({
            year, month, task_date, category, task_name,
            sort_order: sort_order ?? 0,
            created_by: auth.userId,
          })
          .select()
          .single();
        if (error) throw error;
        return NextResponse.json({ data });
      }

      case 'update_task': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { taskId, updates } = body;
        if (!taskId) return NextResponse.json({ error: 'taskId は必須です' }, { status: 400 });

        const allowedFields = ['task_name', 'task_date', 'category', 'note', 'sort_order'];
        const filteredUpdates: Record<string, unknown> = {};
        for (const key of allowedFields) {
          if (updates[key] !== undefined) filteredUpdates[key] = updates[key];
        }
        filteredUpdates.updated_at = new Date().toISOString();

        const { data, error } = await supabaseAdmin
          .from('monthly_tasks')
          .update(filteredUpdates)
          .eq('id', taskId)
          .select()
          .single();
        if (error) throw error;
        return NextResponse.json({ data });
      }

      case 'delete_task': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { taskId: deleteId } = body;
        if (!deleteId) return NextResponse.json({ error: 'taskId は必須です' }, { status: 400 });
        const { error } = await supabaseAdmin
          .from('monthly_tasks')
          .delete()
          .eq('id', deleteId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'toggle_check': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { taskId: checkTaskId, schoolId, isCompleted } = body;
        if (!checkTaskId || !schoolId) {
          return NextResponse.json({ error: 'taskId, schoolId は必須です' }, { status: 400 });
        }

        // upsert チェック
        const { data: existing } = await supabaseAdmin
          .from('monthly_task_checks')
          .select('id')
          .eq('task_id', checkTaskId)
          .eq('school_id', schoolId)
          .maybeSingle();

        if (existing) {
          await supabaseAdmin
            .from('monthly_task_checks')
            .update({
              is_completed: isCompleted,
              completed_at: isCompleted ? new Date().toISOString() : null,
              completed_by: isCompleted ? auth.userId : null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
        } else {
          await supabaseAdmin
            .from('monthly_task_checks')
            .insert({
              task_id: checkTaskId,
              school_id: schoolId,
              is_completed: isCompleted,
              completed_at: isCompleted ? new Date().toISOString() : null,
              completed_by: isCompleted ? auth.userId : null,
            });
        }

        // 双方向同期: 講習スケジュールタスクのis_completedも更新
        const { data: task } = await supabaseAdmin
          .from('monthly_tasks')
          .select('linked_schedule_task_id')
          .eq('id', checkTaskId)
          .single();

        if (task?.linked_schedule_task_id) {
          // 該当教室のschedule_taskを更新
          await supabaseAdmin
            .from('course_prep_schedule_tasks')
            .update({ is_completed: isCompleted, updated_at: new Date().toISOString() })
            .eq('id', task.linked_schedule_task_id)
            .eq('school_id', schoolId);
        }

        return NextResponse.json({ success: true });
      }

      case 'update_note': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { taskId: noteTaskId, note } = body;
        if (!noteTaskId) return NextResponse.json({ error: 'taskId は必須です' }, { status: 400 });
        const { error } = await supabaseAdmin
          .from('monthly_tasks')
          .update({ note, updated_at: new Date().toISOString() })
          .eq('id', noteTaskId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'generate_from_template': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { year, month, templateId } = body;
        if (!year || !month || !templateId) {
          return NextResponse.json({ error: 'year, month, templateId は必須です' }, { status: 400 });
        }

        // テンプレート取得
        const { data: template, error: tplErr } = await supabaseAdmin
          .from('monthly_task_templates')
          .select('*')
          .eq('id', templateId)
          .single();
        if (tplErr || !template) {
          return NextResponse.json({ error: 'テンプレートが見つかりません' }, { status: 404 });
        }

        const templateData = template.template_data as Array<{
          day_of_month: number;
          task_name: string;
          category: string;
          sort_order: number;
        }>;

        // 月の日数を取得
        const daysInMonth = new Date(year, month, 0).getDate();

        const tasksToInsert = templateData
          .filter((item) => item.day_of_month <= daysInMonth)
          .map((item) => ({
            year,
            month,
            task_date: `${year}-${String(month).padStart(2, '0')}-${String(item.day_of_month).padStart(2, '0')}`,
            category: item.category,
            task_name: item.task_name,
            sort_order: item.sort_order,
            template_id: templateId,
            created_by: auth.userId,
          }));

        if (tasksToInsert.length > 0) {
          const { error: insertErr } = await supabaseAdmin
            .from('monthly_tasks')
            .insert(tasksToInsert);
          if (insertErr) throw insertErr;
        }

        return NextResponse.json({ data: { created: tasksToInsert.length } });
      }

      case 'sync_course_tasks': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { year, month } = body;
        if (!year || !month) {
          return NextResponse.json({ error: 'year, month は必須です' }, { status: 400 });
        }

        const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        // 該当月のseasonを推定
        const seasonMap: Record<number, string> = {
          3: 'spring', 4: 'spring',
          7: 'summer', 8: 'summer',
          12: 'winter', 1: 'winter',
        };

        // 該当月に期間が重なるschedule_tasksを取得
        const { data: scheduleTasks, error: stErr } = await supabaseAdmin
          .from('course_prep_schedule_tasks')
          .select('id, school_id, name, start_date, end_date, is_completed, major_category')
          .or(`start_date.lte.${monthEnd},end_date.gte.${monthStart},start_date.gte.${monthStart}`)
          .not('start_date', 'is', null);

        if (stErr) throw stErr;
        if (!scheduleTasks || scheduleTasks.length === 0) {
          return NextResponse.json({ data: { imported: 0 } });
        }

        // 既にリンク済みのschedule_task_idを取得
        const { data: existingLinks } = await supabaseAdmin
          .from('monthly_tasks')
          .select('linked_schedule_task_id')
          .eq('year', year)
          .eq('month', month)
          .not('linked_schedule_task_id', 'is', null);

        const linkedIds = new Set(
          (existingLinks || []).map((l: Record<string, unknown>) => l.linked_schedule_task_id)
        );

        // 教室横断でタスク名をユニーク化（同名タスクは1つだけ作成）
        const taskNameMap = new Map<string, { name: string; date: string; scheduleTaskIds: string[]; schoolCompletions: Map<string, boolean> }>();

        for (const st of scheduleTasks) {
          if (linkedIds.has(st.id)) continue;
          const key = st.name;
          if (!taskNameMap.has(key)) {
            // タスクの日付を決定（start_dateを基準、月内にクランプ）
            let taskDate = st.start_date;
            if (taskDate < monthStart) taskDate = monthStart;
            if (taskDate > monthEnd) taskDate = monthEnd;
            taskNameMap.set(key, {
              name: st.name,
              date: taskDate,
              scheduleTaskIds: [st.id],
              schoolCompletions: new Map([[st.school_id, st.is_completed]]),
            });
          } else {
            const entry = taskNameMap.get(key)!;
            entry.scheduleTaskIds.push(st.id);
            entry.schoolCompletions.set(st.school_id, st.is_completed);
          }
        }

        let imported = 0;
        const entries = Array.from(taskNameMap.values());
        for (const entry of entries) {
          // monthly_task作成（最初のschedule_task_idでリンク）
          const { data: newTask, error: insertErr } = await supabaseAdmin
            .from('monthly_tasks')
            .insert({
              year,
              month,
              task_date: entry.date,
              category: 'course',
              task_name: entry.name,
              sort_order: 0,
              linked_schedule_task_id: entry.scheduleTaskIds[0],
              created_by: auth.userId,
            })
            .select('id')
            .single();

          if (insertErr || !newTask) continue;

          // 各教室のチェック状態を初期化
          const completionEntries: [string, boolean][] = Array.from(entry.schoolCompletions.entries());
          const checksToInsert = completionEntries.map(
            ([schoolId, isCompleted]) => ({
              task_id: newTask.id,
              school_id: schoolId,
              is_completed: isCompleted,
              completed_at: isCompleted ? new Date().toISOString() : null,
            })
          );

          if (checksToInsert.length > 0) {
            await supabaseAdmin.from('monthly_task_checks').insert(checksToInsert);
          }

          imported++;
        }

        return NextResponse.json({ data: { imported } });
      }

      case 'save_template': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { year, month, name } = body;
        if (!year || !month || !name) {
          return NextResponse.json({ error: 'year, month, name は必須です' }, { status: 400 });
        }

        // 現在の月のタスクを取得
        const { data: tasks, error: taskErr } = await supabaseAdmin
          .from('monthly_tasks')
          .select('task_date, task_name, category, sort_order')
          .eq('year', year)
          .eq('month', month)
          .order('task_date')
          .order('sort_order');

        if (taskErr) throw taskErr;

        const templateData = (tasks || []).map((t: Record<string, unknown>) => ({
          day_of_month: new Date(t.task_date as string).getDate(),
          task_name: t.task_name,
          category: t.category,
          sort_order: t.sort_order,
        }));

        const { data, error } = await supabaseAdmin
          .from('monthly_task_templates')
          .insert({ name, template_data: templateData })
          .select()
          .single();

        if (error) throw error;
        return NextResponse.json({ data });
      }

      case 'delete_template': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { templateId: delTplId } = body;
        if (!delTplId) return NextResponse.json({ error: 'templateId は必須です' }, { status: 400 });
        const { error } = await supabaseAdmin
          .from('monthly_task_templates')
          .delete()
          .eq('id', delTplId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: `不明なアクション: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('[api/tasks POST]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'サーバーエラー' },
      { status: 500 }
    );
  }
}
