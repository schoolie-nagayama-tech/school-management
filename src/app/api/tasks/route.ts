import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getApiAuth, isSchoolInScope } from '@/lib/api-auth';
import { isOwnerOrAbove } from '@/lib/utils/roles';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import { apiErrorResponse } from '@/lib/api-error';

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

        // task_date/sort_order は一意でないので id を最終ソートキーに加えて安定ページング。
        const tasks = await fetchAllPaged<Record<string, unknown>>((from, to) =>
          supabaseAdmin
            .from('monthly_tasks')
            .select('*')
            .eq('year', year)
            .eq('month', month)
            .order('task_date', { ascending: true })
            .order('sort_order', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        );

        // チェック情報を一括取得。(タスク数 × 教室数) でスケールし結果が 1000 行を
        // 超えうるため .range() で全件ページング取得する（taskIds で .in() しつつページング）。
        //
        // ★ school_id を操作者の教室に絞る理由:
        //   このルートは service role（RLS バイパス）で動くため、絞らないと他教室の
        //   進捗・オーバーライド内容までレスポンスに載る。画面側は自教室ぶんしか
        //   描画しない（activeSchools ⊆ auth.schoolIds）ので、絞っても表示は変わらない。
        //   admin/owner は schoolIds に全教室が入るため従来どおり全件見える。
        const taskIds = tasks.map((t) => (t as { id: string }).id);
        let checks: Array<Record<string, unknown>> = [];
        if (taskIds.length > 0 && auth.schoolIds.length > 0) {
          checks = await fetchAllPaged<Record<string, unknown>>((from, to) =>
            supabaseAdmin
              .from('monthly_task_checks')
              .select('*')
              .in('task_id', taskIds)
              .in('school_id', auth.schoolIds)
              .order('id', { ascending: true })
              .range(from, to)
          );
        }

        // 教室別オーバーライドを一括取得（同上、全件ページング取得。school_id を絞る理由も同上）
        let overrides: Array<Record<string, unknown>> = [];
        if (taskIds.length > 0 && auth.schoolIds.length > 0) {
          // monthly_task_overrides は複合PK (task_id, school_id) で id 列が無いため、
          // 安定ページングはこの2列でソートする。
          overrides = await fetchAllPaged<Record<string, unknown>>((from, to) =>
            supabaseAdmin
              .from('monthly_task_overrides')
              .select('*')
              .in('task_id', taskIds)
              .in('school_id', auth.schoolIds)
              .order('task_id', { ascending: true })
              .order('school_id', { ascending: true })
              .range(from, to)
          ).catch(() => []);
        }

        // タスクにチェック情報とオーバーライドを付与
        const tasksWithChecks = (tasks || []).map((task: Record<string, unknown>) => ({
          ...task,
          checks: checks.filter((c) => c.task_id === task.id),
          overrides: overrides.filter((o) => o.task_id === task.id),
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

      case 'get_progress_widget': {
        const today = new Date().toISOString().split('T')[0];
        const yr = new Date().getFullYear();
        const mo = new Date().getMonth() + 1;

        // 教室フィルタ: クエリで指定があればそれを使う、なければ全schoolIds
        const schoolIdParam = url.searchParams.get('schoolIds');
        const sids = schoolIdParam
          ? schoolIdParam.split(',').filter((s) => auth.schoolIds.includes(s))
          : auth.schoolIds;

        if (sids.length === 0) {
          return NextResponse.json({
            data: { allComplete: true, tasks: [], coursePrepTasks: [], schoolSummaries: [] },
          });
        }

        // タスク・チェック・オーバーライドを並列取得（いずれも全件ページング取得）
        type TaskRow = { id: string; task_date: string; task_name: string; category: string };
        const allTasks = await fetchAllPaged<TaskRow>((from, to) =>
          supabaseAdmin
            .from('monthly_tasks')
            .select('id, task_date, task_name, category')
            .eq('year', yr)
            .eq('month', mo)
            .order('task_date', { ascending: true })
            .order('sort_order', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        );

        const incompleteTasks: (TaskRow & { overdue: boolean; incompleteSchoolIds: string[] })[] =
          [];
        let allComplete = true;

        // 教室ごとの進捗サマリー（「すべての教室」表示時に教室別の進捗率・未完了業務を出すため）。
        // total = その教室で非表示にしていない当月タスク数、incomplete = そのうち未完了数。
        type SchoolTaskSummary = {
          schoolId: string;
          total: number;
          incomplete: number;
          incompleteTasks: { id: string; task_name: string; task_date: string; overdue: boolean }[];
        };
        const schoolSummaryMap = new Map<string, SchoolTaskSummary>();
        for (const sid of sids) {
          schoolSummaryMap.set(sid, {
            schoolId: sid,
            total: 0,
            incomplete: 0,
            incompleteTasks: [],
          });
        }

        if (allTasks.length > 0) {
          const allIds = allTasks.map((t) => t.id);

          // (タスク数 × 教室数) で 1000 行を超えうるため結果を .range() でページング取得。
          const [allChecks, hiddenOverrides] = await Promise.all([
            fetchAllPaged<Record<string, unknown>>((from, to) =>
              supabaseAdmin
                .from('monthly_task_checks')
                .select('task_id, school_id, is_completed')
                .in('task_id', allIds)
                .in('school_id', sids)
                .order('id', { ascending: true })
                .range(from, to)
            ).catch(() => []),
            fetchAllPaged<Record<string, unknown>>((from, to) =>
              supabaseAdmin
                .from('monthly_task_overrides')
                .select('task_id, school_id, is_hidden')
                .in('task_id', allIds)
                .in('school_id', sids)
                .eq('is_hidden', true)
                // 複合PK (task_id, school_id) で id 列が無いためこの2列でソートする。
                .order('task_id', { ascending: true })
                .order('school_id', { ascending: true })
                .range(from, to)
            ).catch(() => []),
          ]);

          const hiddenSet = new Set(
            hiddenOverrides.map((o: Record<string, unknown>) => `${o.task_id}:${o.school_id}`)
          );

          for (const task of allTasks) {
            const incomplete: string[] = [];
            const isOverdue = task.task_date < today;
            for (const sid of sids) {
              if (hiddenSet.has(`${task.id}:${sid}`)) continue;
              // 非表示でない＝この教室の対象タスク。total に計上する。
              const summary = schoolSummaryMap.get(sid);
              if (summary) summary.total++;
              const check = allChecks.find(
                (c: Record<string, unknown>) => c.task_id === task.id && c.school_id === sid
              );
              if (!check || !check.is_completed) {
                incomplete.push(sid);
                if (summary) {
                  summary.incomplete++;
                  summary.incompleteTasks.push({
                    id: task.id,
                    task_name: task.task_name,
                    task_date: task.task_date,
                    overdue: isOverdue,
                  });
                }
              }
            }
            if (incomplete.length > 0) {
              allComplete = false;
              incompleteTasks.push({
                id: task.id,
                task_date: task.task_date,
                task_name: task.task_name,
                category: task.category,
                overdue: isOverdue,
                incompleteSchoolIds: incomplete,
              });
            }
          }
        }

        // 教室順を安定させる（未完了件数の多い教室を先頭に＝要対応の教室が上に来る）。
        const schoolSummaries = Array.from(schoolSummaryMap.values()).sort(
          (a, b) => b.incomplete - a.incomplete
        );

        // 講習準備スケジュールタスク: 未完了 & 期限が今日から14日以内 or 期限超過
        const futureLimit = new Date();
        futureLimit.setDate(futureLimit.getDate() + 14);
        const futureLimitStr = futureLimit.toISOString().split('T')[0];

        // 複数教室の未完了・期限内タスクは件数が増えうるため全件ページング取得。
        const schedTasks = await fetchAllPaged<{
          id: string;
          name: string;
          deadline: string | null;
          start_date: string | null;
          end_date: string | null;
          major_category: string;
        }>((from, to) =>
          supabaseAdmin
            .from('course_prep_schedule_tasks')
            .select('id, name, deadline, start_date, end_date, major_category, is_completed')
            .in('school_id', sids)
            .eq('is_completed', false)
            .not('deadline', 'is', null)
            .lte('deadline', futureLimitStr)
            .order('deadline', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        ).catch(() => []);

        const coursePrepTasks = schedTasks.map((t) => ({
          id: t.id,
          name: t.name,
          deadline: t.deadline,
          start_date: t.start_date,
          end_date: t.end_date,
          major_category: t.major_category,
          overdue: t.deadline ? t.deadline < today : false,
        }));

        return NextResponse.json({
          data: { allComplete, tasks: incompleteTasks, coursePrepTasks, schoolSummaries },
        });
      }

      case 'get_overdue_summary': {
        // 今日以前の未完了タスクをカウント
        const today = new Date().toISOString().split('T')[0];
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;

        const overdueTasks = await fetchAllPaged<{
          id: string;
          task_date: string;
          task_name: string;
          category: string;
        }>((from, to) =>
          supabaseAdmin
            .from('monthly_tasks')
            .select('id, task_date, task_name, category')
            .eq('year', currentYear)
            .eq('month', currentMonth)
            .lt('task_date', today)
            .order('id', { ascending: true })
            .range(from, to)
        );

        if (overdueTasks.length === 0) {
          return NextResponse.json({ data: { count: 0, tasks: [] } });
        }

        // (タスク数 × 教室数) で 1000 行を超えうるため結果を全件ページング取得。
        const taskIds = overdueTasks.map((t) => t.id);
        const checks = await fetchAllPaged<Record<string, unknown>>((from, to) =>
          supabaseAdmin
            .from('monthly_task_checks')
            .select('task_id, school_id, is_completed')
            .in('task_id', taskIds)
            .order('id', { ascending: true })
            .range(from, to)
        ).catch(() => []);

        // 全教室で完了済みのタスクを除外
        const schoolIds = auth.schoolIds;
        const incompleteTasks = overdueTasks.filter((task) => {
          const taskChecks = checks.filter(
            (c: Record<string, unknown>) =>
              c.task_id === task.id && schoolIds.includes(c.school_id as string)
          );
          // チェックがない、またはいずれかの教室が未完了
          return (
            taskChecks.length === 0 ||
            taskChecks.some((c: Record<string, unknown>) => !c.is_completed)
          );
        });

        return NextResponse.json({
          data: { count: incompleteTasks.length, tasks: incompleteTasks },
        });
      }

      default:
        return NextResponse.json({ error: `不明なアクション: ${action}` }, { status: 400 });
    }
  } catch (error) {
    // apiErrorResponse が内部で captureApiError を呼ぶので、ここで二重送信しない
    return apiErrorResponse(
      error,
      {
        route: 'GET /api/tasks',
        action: action ?? undefined,
        userId: auth.userId,
        role: auth.role,
      },
      'タスクの取得に失敗しました。時間をおいて再度お試しください。'
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

  // manager 以上のみ編集可能。
  // ロール文字列は大小混在で入りうるため toLowerCase で正規化する
  // （requireManager / requireAdmin など既存ゲートも同じ正規化をしている。
  //   ここだけ大小区別のままだと「UI では編集できるのに API が403」というズレが出る）。
  const roleLower = (auth.role || '').toLowerCase();
  const editableRoles = ['admin', 'owner', 'manager'];
  const canEdit = editableRoles.includes(roleLower);

  // 全教室共通のマスタ（monthly_tasks 本体）を書き換えてよいのは admin / owner だけ。
  //
  // ★ なぜここで判定が要るか:
  //   このルートは service role クライアント（RLS 完全バイパス）で動くので、
  //   教室スコープを守れるのはアプリ側のこの判定だけ。canEdit だけでは
  //   教室長(manager)が全教室のタスクマスタを更新・削除できてしまう。
  const canEditSharedMaster = isOwnerOrAbove(auth.role);

  // 教室スコープ外の schoolId を指定されたときの共通レスポンス。
  const outOfScopeResponse = () =>
    NextResponse.json({ error: 'この教室を操作する権限がありません' }, { status: 403 });

  try {
    switch (action) {
      case 'create_task': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { year, month, task_date, category, task_name, sort_order, note, url } = body;
        if (!year || !month || !task_date || !category || !task_name) {
          return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
        }
        const { data, error } = await supabaseAdmin
          .from('monthly_tasks')
          .insert({
            year,
            month,
            task_date,
            category,
            task_name,
            sort_order: sort_order ?? 0,
            note: note || null,
            url: url || null,
            created_by: auth.userId,
          })
          .select()
          .single();
        if (error) throw error;
        return NextResponse.json({ data });
      }

      case 'update_task': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { taskId, updates, schoolId } = body;
        if (!taskId) return NextResponse.json({ error: 'taskId は必須です' }, { status: 400 });

        // オーバーライド行に載せてよい項目（sort_order はベースタスク専用）
        const overrideFields = ['task_name', 'task_date', 'category', 'note', 'url'];
        /** 指定教室ぶんのオーバーライド行を組み立てる */
        const buildOverrideRow = (sid: string) => {
          const row: Record<string, unknown> = {
            task_id: taskId,
            school_id: sid,
            updated_at: new Date().toISOString(),
          };
          for (const key of overrideFields) {
            if (updates[key] !== undefined) row[key] = updates[key];
          }
          return row;
        };

        // schoolId が指定されている場合 → 教室別オーバーライドとして保存
        if (schoolId) {
          // 自分の教室スコープ内か必ず検証する（service role なので RLS は効かない）。
          if (!isSchoolInScope(schoolId, auth.schoolIds)) return outOfScopeResponse();
          const { data, error } = await supabaseAdmin
            .from('monthly_task_overrides')
            .upsert(buildOverrideRow(schoolId), { onConflict: 'task_id,school_id' })
            .select()
            .single();
          if (error) throw error;
          return NextResponse.json({ data, type: 'override' });
        }

        // schoolId なし → 本来は「全教室共通のベースタスク更新」。
        //
        // ★ 教室長(manager)を 403 にせず自教室のオーバーライドへ読み替える理由:
        //   画面(MonthlyTaskPage)は「教室が1つだけ選択されているときだけ schoolId を送る」
        //   実装のため、複数教室を担当する教室長が「すべての教室」表示のまま編集すると
        //   schoolId 無しで届く。ここで単純に 403 にすると、これまで動いていた通常操作が
        //   （画面側は汎用の失敗トーストしか出さないので原因も分からないまま）壊れる。
        //   かといってベースタスクを書き換えると担当外の教室にまで波及するので、
        //   「自分の担当教室ぶんのオーバーライド」に閉じて保存する＝見た目の結果は同じで、
        //   他教室には触れない。UI が送ってくる更新項目は overrideFields に全て含まれる。
        if (!canEditSharedMaster) {
          if (auth.schoolIds.length === 0) return outOfScopeResponse();
          const rows = auth.schoolIds.map(buildOverrideRow);
          const { error } = await supabaseAdmin
            .from('monthly_task_overrides')
            .upsert(rows, { onConflict: 'task_id,school_id' });
          if (error) throw error;
          return NextResponse.json({ data: rows, type: 'override' });
        }

        const allowedFields = ['task_name', 'task_date', 'category', 'note', 'url', 'sort_order'];
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
        const { taskId: deleteId, schoolId: deleteSchoolId } = body;
        if (!deleteId) return NextResponse.json({ error: 'taskId は必須です' }, { status: 400 });

        /** 指定教室でこのタスクを非表示にするオーバーライド行 */
        const buildHiddenRow = (sid: string) => ({
          task_id: deleteId,
          school_id: sid,
          is_hidden: true,
          updated_at: new Date().toISOString(),
        });

        // schoolId が指定されている場合 → その教室だけ非表示にする
        if (deleteSchoolId) {
          // 自分の教室スコープ内か必ず検証する（service role なので RLS は効かない）。
          if (!isSchoolInScope(deleteSchoolId, auth.schoolIds)) return outOfScopeResponse();
          const { error } = await supabaseAdmin
            .from('monthly_task_overrides')
            .upsert(buildHiddenRow(deleteSchoolId), { onConflict: 'task_id,school_id' });
          if (error) throw error;
          return NextResponse.json({ success: true, type: 'hidden' });
        }

        // schoolId なし → 本来は「タスク自体を全教室から削除」。
        // update_task と同じ理由で、教室長は自教室ぶんの非表示に読み替える
        // （担当外の教室のタスクを消させない。操作者の画面からは消えるので体感は同じ）。
        if (!canEditSharedMaster) {
          if (auth.schoolIds.length === 0) return outOfScopeResponse();
          const { error } = await supabaseAdmin
            .from('monthly_task_overrides')
            .upsert(auth.schoolIds.map(buildHiddenRow), { onConflict: 'task_id,school_id' });
          if (error) throw error;
          return NextResponse.json({ success: true, type: 'hidden' });
        }

        const { error } = await supabaseAdmin.from('monthly_tasks').delete().eq('id', deleteId);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }

      case 'delete_course_tasks': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        // 年月だけ指定で全教室ぶんの講習タスクを一括削除する破壊的操作。
        // 教室を絞る手段が無い（monthly_tasks は全教室共通）ため、教室長には開けない。
        // 画面側も同じ境界でボタンを出し分けている（MonthlyTaskPage の canDeleteSharedMaster）。
        if (!canEditSharedMaster) {
          return NextResponse.json(
            { error: '講習タスクの一括削除は管理者のみ実行できます' },
            { status: 403 }
          );
        }
        const { year: delYear, month: delMonth } = body;
        if (!delYear || !delMonth)
          return NextResponse.json({ error: 'year, month は必須です' }, { status: 400 });
        const { data: deleted, error: delError } = await supabaseAdmin
          .from('monthly_tasks')
          .delete()
          .eq('year', delYear)
          .eq('month', delMonth)
          .eq('category', 'course')
          .select('id');
        if (delError) throw delError;
        return NextResponse.json({ success: true, deleted: deleted?.length || 0 });
      }

      case 'batch_toggle_check': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const {
          taskId: batchTaskId,
          schoolIds: batchSchoolIds,
          isCompleted: batchCompleted,
        } = body;
        if (
          !batchTaskId ||
          !batchSchoolIds ||
          !Array.isArray(batchSchoolIds) ||
          batchSchoolIds.length === 0
        ) {
          return NextResponse.json({ error: 'taskId, schoolIds は必須です' }, { status: 400 });
        }

        const validSchoolIds = (batchSchoolIds as string[]).filter((s: string) =>
          auth.schoolIds.includes(s)
        );
        if (validSchoolIds.length === 0) {
          return NextResponse.json({ error: '権限のある教室がありません' }, { status: 403 });
        }

        const { data: existingChecks } = await supabaseAdmin
          .from('monthly_task_checks')
          .select('id, school_id')
          .eq('task_id', batchTaskId)
          .in('school_id', validSchoolIds);

        const existingMap = new Map(
          (existingChecks || []).map((c: { id: string; school_id: string }) => [c.school_id, c.id])
        );
        const toUpdate: string[] = [];
        const toInsert: {
          task_id: string;
          school_id: string;
          is_completed: boolean;
          completed_at: string | null;
          completed_by: string | null;
        }[] = [];

        for (const sid of validSchoolIds) {
          if (existingMap.has(sid)) {
            toUpdate.push(existingMap.get(sid)!);
          } else {
            toInsert.push({
              task_id: batchTaskId,
              school_id: sid,
              is_completed: batchCompleted,
              completed_at: batchCompleted ? new Date().toISOString() : null,
              completed_by: batchCompleted ? auth.userId : null,
            });
          }
        }

        const ops: PromiseLike<unknown>[] = [];
        if (toUpdate.length > 0) {
          ops.push(
            supabaseAdmin
              .from('monthly_task_checks')
              .update({
                is_completed: batchCompleted,
                completed_at: batchCompleted ? new Date().toISOString() : null,
                completed_by: batchCompleted ? auth.userId : null,
                updated_at: new Date().toISOString(),
              })
              .in('id', toUpdate)
          );
        }
        if (toInsert.length > 0) {
          ops.push(supabaseAdmin.from('monthly_task_checks').insert(toInsert));
        }
        await Promise.all(ops);

        return NextResponse.json({ success: true });
      }

      case 'toggle_check': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { taskId: checkTaskId, schoolId, isCompleted } = body;
        if (!checkTaskId || !schoolId) {
          return NextResponse.json({ error: 'taskId, schoolId は必須です' }, { status: 400 });
        }
        // batch_toggle_check と同じく、対象教室が自分のスコープ内かを必ず検証する
        // （下の course_prep_schedule_tasks への同期も schoolId で絞っているため、
        //   ここを素通しにすると他教室の講習進捗まで書き換わる）。
        if (!isSchoolInScope(schoolId, auth.schoolIds)) return outOfScopeResponse();

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
          await supabaseAdmin.from('monthly_task_checks').insert({
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
          .select('linked_schedule_task_id, task_name, category')
          .eq('id', checkTaskId)
          .single();

        if (task?.linked_schedule_task_id && task.category === 'course') {
          // リンク先のスケジュールタスクからseason/yearを取得
          const { data: linkedSt } = await supabaseAdmin
            .from('course_prep_schedule_tasks')
            .select('name, season, year')
            .eq('id', task.linked_schedule_task_id)
            .single();

          if (linkedSt) {
            // 同名・同シーズン・該当教室のスケジュールタスクを更新（教室横断対応）
            await supabaseAdmin
              .from('course_prep_schedule_tasks')
              .update({ is_completed: isCompleted, updated_at: new Date().toISOString() })
              .eq('name', linkedSt.name)
              .eq('season', linkedSt.season)
              .eq('year', linkedSt.year)
              .eq('school_id', schoolId);
          }
        }

        return NextResponse.json({ success: true });
      }

      case 'update_note': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        // schoolId を受け取らず必ずベースタスク（全教室共通）のメモを書き換えるため、
        // 教室長には開けない。画面からのメモ編集は update_task 経由で
        // 教室別オーバーライドとして保存される（この action の呼び出し元は現状ゼロ）。
        if (!canEditSharedMaster) {
          return NextResponse.json(
            { error: '全教室共通のメモを編集する権限がありません' },
            { status: 403 }
          );
        }
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
          return NextResponse.json(
            { error: 'year, month, templateId は必須です' },
            { status: 400 }
          );
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

        // 該当月に期間が重なるschedule_tasksを取得
        // 条件: start_date <= monthEnd AND (end_date >= monthStart OR end_date IS NULL)
        const { data: scheduleTasks, error: stErr } = await supabaseAdmin
          .from('course_prep_schedule_tasks')
          .select('id, school_id, name, start_date, end_date, is_completed, major_category')
          .not('start_date', 'is', null)
          .lte('start_date', monthEnd)
          .or(`end_date.gte.${monthStart},end_date.is.null`);

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

        // ★ 既にこの月にある講習タスクを「タスク名」で引けるようにする。
        //   linked_schedule_task_id は教室ぶんある schedule_task のうち1件しか記録しないため、
        //   linkedIds だけで判定すると2回目の同期で残りの教室ぶんが未リンク扱いになり、
        //   同じ名前のタスクがもう1行できてしまう（＝全教室で二重に見える）。
        //   monthly_tasks は全教室共通で「タスク名1つ＝1行」なので、名前で存在判定する。
        const { data: existingCourseTasks } = await supabaseAdmin
          .from('monthly_tasks')
          .select('id, task_name')
          .eq('year', year)
          .eq('month', month)
          .eq('category', 'course');

        const existingTaskIdByName = new Map<string, string>();
        for (const t of (existingCourseTasks || []) as { id: string; task_name: string }[]) {
          if (!existingTaskIdByName.has(t.task_name)) existingTaskIdByName.set(t.task_name, t.id);
        }

        // 教室横断でタスク名をユニーク化（同名タスクは1つだけ作成）
        const taskNameMap = new Map<
          string,
          {
            name: string;
            date: string;
            scheduleTaskIds: string[];
            schoolCompletions: Map<string, boolean>;
          }
        >();

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
          // 同名のタスクが既にある＝2回目以降の同期。行は増やさず、チェック行が無い教室ぶんだけ足す
          // （教室が後から講習準備タスクを作った場合の取りこぼしは拾いたいため）。
          // ignoreDuplicates で既存のチェックは上書きしない（手で付けた完了を消さない）。
          const existingTaskId = existingTaskIdByName.get(entry.name);
          if (existingTaskId) {
            const rows = Array.from(entry.schoolCompletions.entries()).map(
              ([schoolId, isCompleted]) => ({
                task_id: existingTaskId,
                school_id: schoolId,
                is_completed: isCompleted,
                completed_at: isCompleted ? new Date().toISOString() : null,
              })
            );
            if (rows.length > 0) {
              await supabaseAdmin
                .from('monthly_task_checks')
                .upsert(rows, { onConflict: 'task_id,school_id', ignoreDuplicates: true });
            }
            continue;
          }

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
          const completionEntries: [string, boolean][] = Array.from(
            entry.schoolCompletions.entries()
          );
          const checksToInsert = completionEntries.map(([schoolId, isCompleted]) => ({
            task_id: newTask.id,
            school_id: schoolId,
            is_completed: isCompleted,
            completed_at: isCompleted ? new Date().toISOString() : null,
          }));

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

        // 現在の月の業務タスクのみ取得（講習タスクはテンプレートに含めない）
        const { data: tasks, error: taskErr } = await supabaseAdmin
          .from('monthly_tasks')
          .select('task_date, task_name, category, sort_order')
          .eq('year', year)
          .eq('month', month)
          .eq('category', 'business')
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

      case 'set_google_event_id': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { taskId: eventTaskId, googleEventId } = body;
        if (!eventTaskId) return NextResponse.json({ error: 'taskId は必須です' }, { status: 400 });
        const { error: eventIdError } = await supabaseAdmin
          .from('monthly_tasks')
          .update({ google_event_id: googleEventId || null, updated_at: new Date().toISOString() })
          .eq('id', eventTaskId);
        if (eventIdError) throw eventIdError;
        return NextResponse.json({ success: true });
      }

      case 'update_template': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { templateId: updTplId, name: updTplName, template_data: updTplData } = body;
        if (!updTplId)
          return NextResponse.json({ error: 'templateId は必須です' }, { status: 400 });
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (updTplName !== undefined) updates.name = updTplName;
        if (updTplData !== undefined) updates.template_data = updTplData;
        const { data: updatedTpl, error: updTplErr } = await supabaseAdmin
          .from('monthly_task_templates')
          .update(updates)
          .eq('id', updTplId)
          .select()
          .single();
        if (updTplErr) throw updTplErr;
        return NextResponse.json({ data: updatedTpl });
      }

      case 'delete_template': {
        if (!canEdit) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        const { templateId: delTplId } = body;
        if (!delTplId)
          return NextResponse.json({ error: 'templateId は必須です' }, { status: 400 });
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
    // apiErrorResponse が内部で captureApiError を呼ぶので、ここで二重送信しない
    return apiErrorResponse(
      error,
      {
        route: 'POST /api/tasks',
        action: action ?? undefined,
        userId: auth.userId,
        role: auth.role,
      },
      'タスクの保存に失敗しました。時間をおいて再度お試しください。'
    );
  }
}
