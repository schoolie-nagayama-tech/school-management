import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { fetchAllInChunks } from '@/lib/utils/supabasePaging';
import {
  sanitizePriceTable,
  sanitizeEndByGrade,
  validatePublishWindow,
} from '@/lib/utils/koushuApplySettings';
import { apiErrorResponse } from '@/lib/api-error';
// データ取得の実体は lib 側に置いてある（確定保存を日次cronからも同じロジックで作るため）。
import {
  getSupabaseAdmin,
  enrolledDuringPeriodFilter,
  fetchPeriodStart,
  runBatchForSchool,
  buildSnapshotPayload,
} from '@/lib/server/coursePrepBatch';

export const dynamic = 'force-dynamic';

/**
 * 入力バリデーション NG をそのまま 400 で返す。
 *
 * ここで返す文言は koushuApplySettings のバリデータが組み立てた利用者向けの日本語
 * （例:「公開の終了日時は開始日時より後にしてください」）であり、DB のカラム名・制約名
 * といった内部構造は含まない。利用者が自力で直せる情報なので、apiErrorResponse の
 * 固定文言に潰さずそのまま見せる。DB 由来の例外とは扱いが違うことを名前で示すために
 * 関数に切り出している。
 */
function validationError(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
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
 * save_snapshot: 期の進捗管理表を確定保存する（取り直しは同じ行への upsert）。
 * summary は一覧表示用のキャッシュなので、集計は保存側では行わずクライアントが
 * payload から現行ロジックで計算する（定義がブレないようにするため）。
 */
async function handleSaveSnapshot(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  season: string,
  year: number,
  capturedBy: string | null,
  captureReason: 'manual' | 'auto',
  summary: Record<string, unknown> | null
) {
  if (!season || !year) {
    return NextResponse.json({ error: 'season と year が必要です' }, { status: 400 });
  }

  const { payload, studentCount } = await buildSnapshotPayload(
    supabaseAdmin,
    schoolId,
    season,
    year
  );

  // 中身が無い期を確定保存すると「保存済みなのに空」という最悪の状態を作るので弾く。
  if (studentCount === 0 || payload.items.length === 0) {
    return NextResponse.json(
      { error: '生徒または進捗項目が無いため確定保存できません' },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from('course_prep_snapshots')
    .upsert(
      {
        school_id: schoolId,
        season,
        year,
        payload,
        summary,
        student_count: studentCount,
        captured_at: new Date().toISOString(),
        captured_by: capturedBy,
        capture_reason: captureReason,
      },
      { onConflict: 'school_id,season,year' }
    )
    .select('id, captured_at, captured_by, capture_reason, student_count')
    .single();

  if (error) {
    return apiErrorResponse(
      error,
      { route: 'POST /api/courses/prep', action: 'save_snapshot', schoolId },
      '確定保存に失敗しました。時間をおいて再度お試しください。'
    );
  }
  return NextResponse.json({ data });
}

/**
 * batch_get_multi: 複数校分の batch_get を1リクエストで処理する。
 *
 * 目的: 教室別に4本の HTTP リクエストを投げる構成を1本に統合し、
 * リクエスト本数と認証往復（getApiAuth の getUser→user_profiles→schools）を削減する。
 *
 * security: サービスロールで RLS をバイパスするため、認可をここで厳密に行う。
 * 要求された schoolIds のうち1つでもアクセス不可が混じっていたら 403 を返す
 * （既存の単一校 batch_get が権限無しを 403 にしているのと整合させ、黙って落とさない）。
 */
async function handleBatchGetMulti(request: NextRequest, url: URL) {
  try {
    // schoolIds はカンマ区切り。空要素は除去する。
    const schoolIds = (url.searchParams.get('schoolIds') || '').split(',').filter(Boolean);
    if (schoolIds.length === 0) {
      return NextResponse.json({ error: 'schoolIds が必要です' }, { status: 400 });
    }

    // 認証は getApiAuth を1回だけ呼ぶ（複数校でも認証往復は1回で済ませる）。
    const { auth } = await getApiAuth(request);
    if (!auth) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // 認可: admin/owner は auth.schoolIds に全校が入っている。
    // 要求校に1つでもアクセス不可が混じっていたら 403（部分許可で黙って落とさない）。
    const unauthorized = schoolIds.filter((sid) => !auth.schoolIds.includes(sid));
    if (unauthorized.length > 0) {
      return NextResponse.json({ error: 'アクセス権のない教室が含まれています' }, { status: 403 });
    }

    // パース方法は GET 本体と同一に揃える。
    const season = url.searchParams.get('season') || '';
    const year = parseInt(url.searchParams.get('year') || '0', 10);
    const includeHidden = url.searchParams.get('includeHidden') === 'true';
    const targets = (url.searchParams.get('targets') || '').split(',').filter(Boolean);

    // service role クライアントは1回だけ生成し、全校を並列実行する。
    const supabaseAdmin = getSupabaseAdmin();
    const entries = await Promise.all(
      schoolIds.map((sid) =>
        runBatchForSchool(supabaseAdmin, sid, season, year, includeHidden, targets).then(
          (r) => [sid, r] as [string, Record<string, unknown>]
        )
      )
    );

    // schoolId → batchResult のマップで返す。
    const result: Record<string, Record<string, unknown>> = {};
    for (const [sid, r] of entries) {
      result[sid] = r;
    }
    return NextResponse.json({ data: result });
  } catch (error) {
    return apiErrorResponse(
      error,
      { route: 'GET /api/courses/prep', action: 'batch_get_multi' },
      '講習準備データの取得に失敗しました。時間をおいて再度お試しください。'
    );
  }
}

/**
 * GET /api/courses/prep?action=...&schoolId=...&season=...&year=...
 *
 * サービスロールキーで RLS をバイパスして講習準備データを読み取る
 */
export async function GET(request: NextRequest) {
  // catch 側でも「どのアクションで落ちたか」を Sentry に残せるよう try の外に保持する
  let actionForLog: string | null = null;
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    actionForLog = action;
    const schoolId = url.searchParams.get('schoolId');

    // 複数校バッチは単一 schoolId を持たないため、単一必須チェックの「前」に分岐する。
    // 認証・認可は handleBatchGetMulti 内で複数校向けに別途行う。
    if (action === 'batch_get_multi') {
      return await handleBatchGetMulti(request, url);
    }

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
      // 確定保存された期の中身を丸ごと返す。表示側はこの payload だけで表を再生する。
      case 'get_snapshot': {
        const { data, error } = await supabaseAdmin
          .from('course_prep_snapshots')
          .select('*')
          .eq('school_id', schoolId)
          .eq('season', season)
          .eq('year', year)
          .maybeSingle();
        if (error) {
          return apiErrorResponse(error, {
            route: 'GET /api/courses/prep',
            action: 'get_snapshot',
            schoolId,
          });
        }
        return NextResponse.json({ data: data ?? null });
      }

      // 確定保存済みの期の一覧（payload は返さない。年度をまたいだ選択肢の提示用）。
      case 'list_snapshots': {
        const { data, error } = await supabaseAdmin
          .from('course_prep_snapshots')
          .select('id, season, year, captured_at, capture_reason, student_count, summary')
          .eq('school_id', schoolId)
          .order('year', { ascending: false })
          .order('season', { ascending: true });
        if (error) {
          return apiErrorResponse(error, {
            route: 'GET /api/courses/prep',
            action: 'list_snapshots',
            schoolId,
          });
        }
        return NextResponse.json({ data: data || [] });
      }

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
        if (error)
          return apiErrorResponse(
            error,
            { route: 'GET /api/courses/prep', action: 'get_progress_items', schoolId },
            '進捗管理項目の取得に失敗しました。時間をおいて再度お試しください。'
          );
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
        // 1項目につき生徒数分の行が返る（1対多）ため、チャンク分割＋チャンク内ページングで全件取得する。
        // 未ページングだと1000行で切り捨てられ、進捗が保存されていないように見える。
        try {
          const data = await fetchAllInChunks(itemIds, (chunk, from, to) =>
            supabaseAdmin
              .from('course_prep_student_progress')
              .select('*')
              .eq('school_id', schoolId)
              .in('item_id', chunk)
              .order('id', { ascending: true })
              .range(from, to)
          );
          return NextResponse.json({ data });
        } catch (e) {
          return apiErrorResponse(
            e,
            { route: 'GET /api/courses/prep', action: 'get_student_progress', schoolId },
            '生徒の進捗の取得に失敗しました。時間をおいて再度お試しください。'
          );
        }
      }

      // 削除ダイアログ用: 進捗表に何が入っているか（消える件数）をサーバーで数える
      case 'get_progress_table_summary': {
        const summary = await countProgressTable(supabaseAdmin, schoolId, season, year);
        return NextResponse.json({
          data: {
            item_count: summary.itemIds.length,
            progress_count: summary.progressCount,
            has_period: summary.hasPeriod,
            linked_task_count: summary.linkedTasks,
          },
        });
      }

      case 'get_period': {
        const { data, error } = await supabaseAdmin
          .from('course_prep_periods')
          .select('*')
          .eq('school_id', schoolId)
          .eq('season', season)
          .eq('year', year)
          .maybeSingle();

        if (error)
          return apiErrorResponse(
            error,
            { route: 'GET /api/courses/prep', action: 'get_period', schoolId },
            '講習期間の設定の取得に失敗しました。時間をおいて再度お試しください。'
          );
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
          // PostgREST フィルタインジェクション対策: season を .or() 文字列に直接埋め込むため、
          // 英数字・ハイフン・アンダースコアのみ許可（カンマ/ピリオド/括弧での演算子注入を防ぐ）。
          // 不正な文字を含む場合は安全な .eq() のみで絞る。
          if (/^[A-Za-z0-9_-]+$/.test(season)) {
            query = query.or(`season.eq.${season},season.is.null`);
          } else {
            query = query.eq('season', season);
          }
        }

        const { data, error } = await query;
        if (error)
          return apiErrorResponse(
            error,
            { route: 'GET /api/courses/prep', action: 'get_templates', schoolId },
            'テンプレートの取得に失敗しました。時間をおいて再度お試しください。'
          );
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

        if (error)
          return apiErrorResponse(
            error,
            { route: 'GET /api/courses/prep', action: 'get_schedule_tasks', schoolId },
            '工程表タスクの取得に失敗しました。時間をおいて再度お試しください。'
          );
        if (!tasks || tasks.length === 0) return NextResponse.json({ data: [] });

        const taskIds = tasks.map((t: { id: string }) => t.id);
        const { data: markers } = await supabaseAdmin
          .from('course_prep_schedule_markers')
          .select('*')
          .in('task_id', taskIds)
          .order('marker_date', { ascending: true });

        const markersByTask = new Map<string, unknown[]>();
        for (const m of markers || []) {
          const tid = (m as { task_id: string }).task_id;
          if (!markersByTask.has(tid)) markersByTask.set(tid, []);
          markersByTask.get(tid)!.push(m);
        }

        // リンクされた進捗項目の進捗率を計算
        const linkedItemIds = tasks
          .map((t: { linked_progress_item_id: string | null }) => t.linked_progress_item_id)
          .filter((id: string | null): id is string => !!id);

        const progressRateMap: Record<string, { total: number; completed: number }> = {};
        if (linkedItemIds.length > 0) {
          const uniqueItemIds = Array.from(new Set(linkedItemIds));

          // 対象生徒数を母数にする。進捗表に出る生徒集合（期間中に在籍していた生徒）と揃える。
          const periodStart = await fetchPeriodStart(supabaseAdmin, schoolId, season, year);
          const { count: studentCount } = await supabaseAdmin
            .from('students')
            .select('id', { count: 'exact', head: true })
            .eq('school_id', schoolId)
            .is('deleted_at', null)
            .or(enrolledDuringPeriodFilter(periodStart))
            .neq('is_test', true); // 研修用テスト生徒は母数に含めない

          const totalStudents = studentCount || 0;

          // 1項目につき生徒数分の行が返るため1000行を超えうる。切り捨てると進捗率が過小になる。
          const progressData = await fetchAllInChunks<{ item_id: string; status: string }>(
            uniqueItemIds,
            (chunk, from, to) =>
              supabaseAdmin
                .from('course_prep_student_progress')
                .select('item_id, status')
                .in('item_id', chunk)
                .order('id', { ascending: true })
                .range(from, to)
          );

          for (const itemId of uniqueItemIds) {
            const related = (progressData || []).filter(
              (p: { item_id: string }) => p.item_id === itemId
            );
            const completed = related.filter(
              (p: { status: string }) => p.status === 'completed'
            ).length;
            progressRateMap[itemId] = { total: totalStudents, completed };
          }
        }

        const result = tasks.map((t: { id: string; linked_progress_item_id: string | null }) => ({
          ...t,
          markers: markersByTask.get(t.id) || [],
          linked_progress_rate: t.linked_progress_item_id
            ? progressRateMap[t.linked_progress_item_id] || null
            : null,
        }));

        return NextResponse.json({ data: result });
      }

      // ===== バッチ取得: 複数データを1リクエストで取得 =====
      // 旧 'get_auto_values' は削除済み。同等のロジックは 'batch_get' の 'auto_values' ターゲットに統合されている。
      case 'batch_get': {
        // per-school ロジックは runBatchForSchool に抽出済み（挙動同一）。
        const targets = (url.searchParams.get('targets') || '').split(',').filter(Boolean);
        const batchResult = await runBatchForSchool(
          supabaseAdmin,
          schoolId,
          season,
          year,
          includeHidden,
          targets
        );
        return NextResponse.json({ data: batchResult });
      }

      default:
        return NextResponse.json({ error: `不明なアクション: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return apiErrorResponse(
      error,
      { route: 'GET /api/courses/prep', action: actionForLog ?? undefined },
      '講習準備データの取得に失敗しました。時間をおいて再度お試しください。'
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
 *   - "delete_progress_table"  : 進捗表（期・年）をまるごと削除（admin/owner のみ）
 *   - "create_schedule_task"   : 工程表タスクを追加
 *   - "update_schedule_task"   : 工程表タスクを更新
 *   - "delete_schedule_task"   : 工程表タスクを削除
 *   - "upsert_schedule_marker" : 工程表マーカーを追加/更新
 *   - "delete_schedule_marker" : 工程表マーカーを削除
 *   - "upsert_period"          : 講習期間メタを更新
 *   - "save_snapshot"         : 期の進捗管理表を確定保存（教室長以上。取り直しは上書き）
 */
export async function POST(request: NextRequest) {
  // catch 側でも「どの操作・どの教室で落ちたか」を Sentry に残せるよう try の外に保持する
  let actionForLog: string | null = null;
  let schoolIdForLog: string | null = null;
  try {
    const body = await request.json();
    const { action, schoolId, ...params } = body;
    actionForLog = typeof action === 'string' ? action : null;
    schoolIdForLog = typeof schoolId === 'string' ? schoolId : null;

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
        return await handleUpdateStudentProgress(supabaseAdmin, { ...params, schoolId });
      case 'update_student_number':
        return await handleUpdateStudentNumber(supabaseAdmin, { ...params, schoolId });
      case 'update_student_date':
        return await handleUpdateStudentDate(supabaseAdmin, { ...params, schoolId });
      case 'update_progress_item':
        return await handleUpdateProgressItem(supabaseAdmin, schoolId, params);
      case 'batch_reorder_items': {
        // 複数項目の sort_order を一括更新（N回→1回）
        const reorderItems = params.items as { id: string; sort_order: number }[];
        if (!reorderItems || reorderItems.length === 0) {
          return NextResponse.json({ error: 'items が必要です' }, { status: 400 });
        }
        await Promise.all(
          reorderItems.map((item) =>
            supabaseAdmin
              .from('course_prep_progress_items')
              .update({ sort_order: item.sort_order })
              .eq('id', item.id)
              .eq('school_id', schoolId)
          )
        );
        return NextResponse.json({ success: true });
      }
      case 'hide_progress_item':
        return await handleHideProgressItem(supabaseAdmin, schoolId, params);
      case 'delete_progress_item':
        return await handleDeleteProgressItem(supabaseAdmin, schoolId, params);
      case 'create_schedule_task':
        return await handleCreateScheduleTask(supabaseAdmin, schoolId, params);
      case 'update_schedule_task':
        return await handleUpdateScheduleTask(supabaseAdmin, schoolId, params);
      case 'batch_link_schedule_tasks': {
        // 複数タスクのリンク解除＋1件リンク設定を1リクエストで（N+1回→1回）
        const unlinkTaskIds = (params.unlinkTaskIds as string[]) || [];
        const linkTaskId = params.linkTaskId as string | null;
        const linkItemId = params.linkItemId as string | null;
        for (const tid of unlinkTaskIds) {
          await supabaseAdmin
            .from('course_prep_schedule_tasks')
            .update({ linked_progress_item_id: null })
            .eq('id', tid)
            .eq('school_id', schoolId);
        }
        if (linkTaskId && linkItemId) {
          await supabaseAdmin
            .from('course_prep_schedule_tasks')
            .update({ linked_progress_item_id: linkItemId })
            .eq('id', linkTaskId)
            .eq('school_id', schoolId);

          // リンク確立時に end_date ↔ deadline を初期同期
          const { data: linkedTask } = await supabaseAdmin
            .from('course_prep_schedule_tasks')
            .select('end_date')
            .eq('id', linkTaskId)
            .single();
          const { data: linkedItem } = await supabaseAdmin
            .from('course_prep_progress_items')
            .select('deadline')
            .eq('id', linkItemId)
            .single();

          if (linkedTask && linkedItem) {
            const taskDate = linkedTask.end_date as string | null;
            const itemDeadline = linkedItem.deadline as string | null;
            if (taskDate && !itemDeadline) {
              await supabaseAdmin
                .from('course_prep_progress_items')
                .update({ deadline: taskDate, updated_at: new Date().toISOString() })
                .eq('id', linkItemId);
            } else if (!taskDate && itemDeadline) {
              await supabaseAdmin
                .from('course_prep_schedule_tasks')
                .update({ end_date: itemDeadline, updated_at: new Date().toISOString() })
                .eq('id', linkTaskId);
            }
          }
        }
        return NextResponse.json({ success: true });
      }
      case 'delete_schedule_task':
        return await handleDeleteScheduleTask(supabaseAdmin, schoolId, params);
      case 'save_template':
        return await handleSaveTemplate(supabaseAdmin, schoolId, params);
      case 'delete_template':
        return await handleDeleteTemplate(supabaseAdmin, params);
      case 'delete_progress_table': {
        // 進捗表まるごとの削除は取り消せないので admin/owner に限定する
        // （UI の isOwnerOrAbove と同じ境界。「ボタンは出ないのに API は叩ける」を作らない）
        const role = (authResult.user.role || '').toLowerCase();
        if (role !== 'admin' && role !== 'owner') {
          return NextResponse.json(
            { error: '進捗表の削除には管理者権限が必要です' },
            { status: 403 }
          );
        }
        return await handleDeleteProgressTable(supabaseAdmin, schoolId, params);
      }
      case 'upsert_schedule_marker':
        return await handleUpsertScheduleMarker(supabaseAdmin, schoolId, params);
      case 'delete_schedule_marker':
        return await handleDeleteScheduleMarker(supabaseAdmin, schoolId, params);
      case 'upsert_period':
        return await handleUpsertPeriod(supabaseAdmin, schoolId, params, authResult.user.role);
      case 'save_snapshot': {
        // 確定保存は実績の正典を作る操作なので教室長以上に限定する
        // （UI の isManagerOrAbove と同じ境界。「ボタンは出ないのに API は叩ける」を作らない）。
        const role = (authResult.user.role || '').toLowerCase();
        if (role !== 'admin' && role !== 'owner' && role !== 'manager') {
          return NextResponse.json(
            { error: '確定保存には教室長以上の権限が必要です' },
            { status: 403 }
          );
        }
        return await handleSaveSnapshot(
          supabaseAdmin,
          schoolId,
          params.season,
          params.year,
          authResult.user.userId ?? null,
          'manual',
          params.summary ?? null
        );
      }
      default:
        return NextResponse.json({ error: `不明なアクション: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        route: 'POST /api/courses/prep',
        action: actionForLog ?? undefined,
        schoolId: schoolIdForLog,
      },
      '講習準備データの操作に失敗しました。時間をおいて再度お試しください。'
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

  type ProgressTemplateItem = {
    name: string;
    column_type: string;
    sort_order: number;
    column_group?: string;
    auto_source?: string;
    manager_only?: boolean;
    deadline?: string;
    is_hidden?: boolean;
  };
  const items = (template as { template_data: ProgressTemplateItem[] }).template_data;
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

  const insertData = items.map((item: ProgressTemplateItem) => ({
    school_id: schoolId,
    season,
    year,
    name: item.name,
    column_type: item.column_type || 'check',
    sort_order: item.sort_order,
    ...(item.column_group !== undefined ? { column_group: item.column_group } : {}),
    ...(item.auto_source !== undefined ? { auto_source: item.auto_source } : {}),
    ...(item.manager_only !== undefined ? { manager_only: item.manager_only } : {}),
    ...(item.deadline !== undefined ? { deadline: item.deadline } : {}),
    ...(item.is_hidden !== undefined ? { is_hidden: item.is_hidden } : {}),
  }));

  const { error: insertError } = await supabaseAdmin
    .from('course_prep_progress_items')
    .insert(insertData);

  if (insertError) {
    return apiErrorResponse(
      insertError,
      { route: 'POST /api/courses/prep', action: 'init_progress_template', schoolId },
      '進捗管理テンプレートの適用に失敗しました。時間をおいて再度お試しください。'
    );
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

  type ScheduleTemplateTask = {
    major_category: string;
    name: string;
    description?: string;
    sort_order: number;
    start_date?: string;
    end_date?: string;
    deadline?: string;
    linked_progress_item_name?: string;
    markers?: Array<{ marker_date: string; label: string; color: string | null }>;
  };
  const tasks = (template as { template_data: ScheduleTemplateTask[] }).template_data;
  if (!tasks || tasks.length === 0) {
    return NextResponse.json({ error: 'テンプレートにタスクがありません' }, { status: 400 });
  }

  // 既存タスク + マーカーを削除
  const { data: existingTasks } = await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .select('id')
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year);
  if (existingTasks && existingTasks.length > 0) {
    const existingIds = existingTasks.map((t: { id: string }) => t.id);
    await supabaseAdmin.from('course_prep_schedule_markers').delete().in('task_id', existingIds);
  }
  await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .delete()
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year);

  // リンク先進捗項目を名前で逆引き（同じ school/season/year の進捗項目から）
  const linkedNames = tasks.map((t) => t.linked_progress_item_name).filter(Boolean) as string[];
  const nameToItemId: Record<string, string> = {};
  if (linkedNames.length > 0) {
    const { data: progressItems } = await supabaseAdmin
      .from('course_prep_progress_items')
      .select('id, name')
      .eq('school_id', schoolId)
      .eq('season', season)
      .eq('year', year)
      .in('name', linkedNames);
    for (const pi of (progressItems || []) as Array<{ id: string; name: string }>) {
      nameToItemId[pi.name] = pi.id;
    }
  }

  // タスクを挿入
  const insertData = tasks.map((task) => ({
    school_id: schoolId,
    season,
    year,
    major_category: task.major_category,
    name: task.name,
    description: task.description ?? null,
    sort_order: task.sort_order,
    ...(task.start_date !== undefined ? { start_date: task.start_date } : {}),
    ...(task.end_date !== undefined ? { end_date: task.end_date } : {}),
    ...(task.deadline !== undefined ? { deadline: task.deadline } : {}),
    ...(task.linked_progress_item_name && nameToItemId[task.linked_progress_item_name]
      ? { linked_progress_item_id: nameToItemId[task.linked_progress_item_name] }
      : {}),
  }));

  const { data: insertedTasks, error: insertError } = await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .insert(insertData)
    .select('id, sort_order');

  if (insertError) {
    return apiErrorResponse(
      insertError,
      { route: 'POST /api/courses/prep', action: 'init_schedule_template', schoolId },
      '工程表テンプレートの適用に失敗しました。時間をおいて再度お試しください。'
    );
  }

  // マーカーを復元
  const sortOrderToId: Record<number, string> = {};
  for (const t of (insertedTasks || []) as Array<{ id: string; sort_order: number }>) {
    sortOrderToId[t.sort_order] = t.id;
  }

  const markerInserts: Array<{
    task_id: string;
    marker_date: string;
    label: string;
    color: string | null;
  }> = [];
  for (const task of tasks) {
    if (task.markers && task.markers.length > 0) {
      const taskId = sortOrderToId[task.sort_order];
      if (taskId) {
        for (const m of task.markers) {
          markerInserts.push({
            task_id: taskId,
            marker_date: m.marker_date,
            label: m.label,
            color: m.color,
          });
        }
      }
    }
  }
  if (markerInserts.length > 0) {
    await supabaseAdmin.from('course_prep_schedule_markers').insert(markerInserts);
  }

  return NextResponse.json({ success: true, count: insertData.length });
}

// ===== 進捗管理項目 =====

async function handleCreateProgressItem(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: {
    season: string;
    year: number;
    name: string;
    columnType: string;
    columnGroup?: string | null;
    autoSource?: string | null;
    sortOrder: number;
  }
) {
  const { season, year, name, columnType, columnGroup, autoSource, sortOrder } = params;

  const insertData: Record<string, unknown> = {
    school_id: schoolId,
    season,
    year,
    name,
    column_type: columnType || 'check',
    sort_order: sortOrder,
  };
  if (columnGroup) insertData.column_group = columnGroup;
  if (autoSource) insertData.auto_source = autoSource;

  const { data, error } = await supabaseAdmin
    .from('course_prep_progress_items')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    return apiErrorResponse(
      error,
      { route: 'POST /api/courses/prep', action: 'create_progress_item', schoolId },
      '進捗管理項目の追加に失敗しました。時間をおいて再度お試しください。'
    );
  }
  return NextResponse.json({ data });
}

async function handleUpdateProgressItem(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { itemId: string; updates: Record<string, unknown> }
) {
  const allowed = ['name', 'column_type', 'deadline', 'auto_source', 'sort_order', 'column_group'];
  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in params.updates) filtered[key] = params.updates[key];
  }
  filtered.updated_at = new Date().toISOString();

  // service role で RLS をバイパスするため、対象 itemId が当該 schoolId のものか
  // school_id 条件で限定する（他教室の項目IDを渡しての改ざんを防ぐ IDOR 対策）
  const { data, error } = await supabaseAdmin
    .from('course_prep_progress_items')
    .update(filtered)
    .eq('id', params.itemId)
    .eq('school_id', schoolId)
    .select()
    .single();

  if (error)
    return apiErrorResponse(
      error,
      { route: 'POST /api/courses/prep', action: 'update_progress_item', schoolId },
      '進捗管理項目の更新に失敗しました。時間をおいて再度お試しください。'
    );

  // 期日同期: deadline が更新された場合、リンク元のスケジュールタスクの end_date も同期
  if (params.updates.deadline !== undefined) {
    try {
      const { data: linkedTasks } = await supabaseAdmin
        .from('course_prep_schedule_tasks')
        .select('id')
        .eq('linked_progress_item_id', params.itemId);

      if (linkedTasks && linkedTasks.length > 0) {
        const ids = linkedTasks.map((t: { id: string }) => t.id);
        await supabaseAdmin
          .from('course_prep_schedule_tasks')
          .update({
            end_date: params.updates.deadline as string | null,
            updated_at: new Date().toISOString(),
          })
          .in('id', ids);
      }
    } catch (syncErr) {
      console.error('[courses/prep] deadline sync (progress→schedule) error:', syncErr);
    }
  }

  return NextResponse.json({ data });
}

async function handleHideProgressItem(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { itemId: string; isHidden: boolean }
) {
  // IDOR 対策: 当該 schoolId の項目のみ更新可能にする
  const { error } = await supabaseAdmin
    .from('course_prep_progress_items')
    .update({ is_hidden: params.isHidden })
    .eq('id', params.itemId)
    .eq('school_id', schoolId);

  if (error) {
    return apiErrorResponse(
      error,
      { route: 'POST /api/courses/prep', action: 'hide_progress_item', schoolId },
      '進捗管理項目の表示・非表示の切り替えに失敗しました。時間をおいて再度お試しください。'
    );
  }
  return NextResponse.json({ success: true });
}

async function handleDeleteProgressItem(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { itemId: string }
) {
  // IDOR 対策: 当該 schoolId の項目のみ削除可能にする
  const { error } = await supabaseAdmin
    .from('course_prep_progress_items')
    .delete()
    .eq('id', params.itemId)
    .eq('school_id', schoolId);

  if (error) {
    return apiErrorResponse(
      error,
      { route: 'POST /api/courses/prep', action: 'delete_progress_item', schoolId },
      '進捗管理項目の削除に失敗しました。時間をおいて再度お試しください。'
    );
  }
  return NextResponse.json({ success: true });
}

// ===== 生徒進捗 =====

async function handleUpdateStudentProgress(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { schoolId: string; studentId: string; itemId: string; status: string | null }
) {
  const { schoolId, studentId, itemId, status } = params;

  // statusがnullの場合はレコード削除（空欄に戻す）
  if (!status) {
    const { error } = await supabaseAdmin
      .from('course_prep_student_progress')
      .delete()
      .eq('school_id', schoolId)
      .eq('student_id', studentId)
      .eq('item_id', itemId);
    if (error)
      return apiErrorResponse(
        error,
        { route: 'POST /api/courses/prep', action: 'update_student_progress:clear', schoolId },
        '進捗の取り消しに失敗しました。時間をおいて再度お試しください。'
      );
  } else {
    // UPSERT で更新する。SELECT→INSERT/UPDATE の非アトミック実装だと、
    // 同一セルを素早く連打（空欄→完了→対象外）した際に2リクエストが競合し、
    // (student_id,item_id) のユニーク制約違反（重複キー500）→画面全体の再読込が起きていた。
    const { error } = await supabaseAdmin.from('course_prep_student_progress').upsert(
      {
        school_id: schoolId,
        student_id: studentId,
        item_id: itemId,
        status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'student_id,item_id' }
    );
    if (error)
      return apiErrorResponse(
        error,
        { route: 'POST /api/courses/prep', action: 'update_student_progress:upsert', schoolId },
        '進捗の保存に失敗しました。時間をおいて再度お試しください。'
      );
  }

  // 自動完了同期: 進捗アイテムにリンクされたスケジュールタスクの完了状態を自動更新
  try {
    await syncScheduleTaskCompletionFromProgress(supabaseAdmin, schoolId, itemId);
  } catch (syncErr) {
    console.error('[courses/prep] auto-complete sync error:', syncErr);
  }

  return NextResponse.json({ success: true });
}

async function handleUpdateStudentNumber(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { schoolId: string; studentId: string; itemId: string; numberValue: number | null }
) {
  const { schoolId, studentId, itemId, numberValue } = params;

  // UPSERT（連打時の重複キー競合を回避）
  const { error } = await supabaseAdmin.from('course_prep_student_progress').upsert(
    {
      school_id: schoolId,
      student_id: studentId,
      item_id: itemId,
      number_value: numberValue,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,item_id' }
  );
  if (error)
    return apiErrorResponse(
      error,
      { route: 'POST /api/courses/prep', action: 'update_student_number', schoolId },
      '数値の保存に失敗しました。時間をおいて再度お試しください。'
    );

  return NextResponse.json({ success: true });
}

async function handleUpdateStudentDate(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { schoolId: string; studentId: string; itemId: string; dateValue: string | null }
) {
  const { schoolId, studentId, itemId, dateValue } = params;

  // UPSERT（連打時の重複キー競合を回避）
  const { error } = await supabaseAdmin.from('course_prep_student_progress').upsert(
    {
      school_id: schoolId,
      student_id: studentId,
      item_id: itemId,
      date_value: dateValue,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,item_id' }
  );
  if (error)
    return apiErrorResponse(
      error,
      { route: 'POST /api/courses/prep', action: 'update_student_date', schoolId },
      '日付の保存に失敗しました。時間をおいて再度お試しください。'
    );

  return NextResponse.json({ success: true });
}

// ===== 工程表タスク =====

async function handleCreateScheduleTask(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: {
    season: string;
    year: number;
    majorCategory: string;
    name: string;
    description?: string;
    sortOrder?: number;
    startDate?: string | null;
    endDate?: string | null;
  }
) {
  let sortOrder = params.sortOrder;
  if (sortOrder == null) {
    const { data: existing } = await supabaseAdmin
      .from('course_prep_schedule_tasks')
      .select('sort_order')
      .eq('school_id', schoolId)
      .eq('season', params.season)
      .eq('year', params.year)
      .order('sort_order', { ascending: false })
      .limit(1);
    sortOrder =
      existing && existing.length > 0 ? (existing[0] as { sort_order: number }).sort_order + 1 : 0;
  }

  const { data, error } = await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .insert({
      school_id: schoolId,
      season: params.season,
      year: params.year,
      major_category: params.majorCategory,
      name: params.name,
      description: params.description || null,
      sort_order: sortOrder,
      ...(params.startDate ? { start_date: params.startDate } : {}),
      ...(params.endDate ? { end_date: params.endDate } : {}),
    })
    .select()
    .single();

  if (error)
    return apiErrorResponse(
      error,
      { route: 'POST /api/courses/prep', action: 'create_schedule_task', schoolId },
      '工程表タスクの追加に失敗しました。時間をおいて再度お試しください。'
    );
  return NextResponse.json({ data });
}

/**
 * 進捗管理の全生徒完了チェック → リンクされたスケジュールタスク自動完了 → 業務進捗にカスケード
 * itemId: course_prep_progress_items.id
 */
async function syncScheduleTaskCompletionFromProgress(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  itemId: string
) {
  // 1. このitemIdにリンクされたスケジュールタスクを取得
  // name/season/year も含めて取得しておくことで、ループ内で taskInfo を再取得する必要をなくす（クエリ削減）
  const { data: scheduleTasks } = await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .select('id, is_completed, name, season, year')
    .eq('linked_progress_item_id', itemId)
    .eq('school_id', schoolId);

  if (!scheduleTasks || scheduleTasks.length === 0) return;

  // 母数は進捗表に出る生徒集合（期間中に在籍していた生徒）と揃える。
  // 1つの進捗項目にリンクされたタスクは同じ期のものなので、先頭の season/year を使う。
  const { season: taskSeason, year: taskYear } = scheduleTasks[0] as {
    season: string;
    year: number;
  };
  const periodStart = await fetchPeriodStart(supabaseAdmin, schoolId, taskSeason, taskYear);

  // 2 & 3. 生徒数と完了済み生徒数を並列取得（互いに独立しているため安全）
  const [{ count: totalStudents }, { count: completedCount }] = await Promise.all([
    supabaseAdmin
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .is('deleted_at', null)
      .or(enrolledDuringPeriodFilter(periodStart))
      .neq('is_test', true), // 研修用テスト生徒は母数に含めない
    supabaseAdmin
      .from('course_prep_student_progress')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', itemId)
      .eq('school_id', schoolId)
      .eq('status', 'completed'),
  ]);

  if (!totalStudents || totalStudents === 0) return;

  const allCompleted = (completedCount || 0) >= totalStudents;

  // 4. 各スケジュールタスクの完了状態を更新（変更がある場合のみ）
  for (const task of scheduleTasks) {
    if (task.is_completed === allCompleted) continue; // 変更なし

    // スケジュールタスクを更新
    await supabaseAdmin
      .from('course_prep_schedule_tasks')
      .update({ is_completed: allCompleted, updated_at: new Date().toISOString() })
      .eq('id', task.id);

    // 5. 業務進捗にカスケード同期（教室横断: 同名タスクのIDすべてで検索）
    // 同じschedule_taskから複数月のmonthly_tasks(Feb/Mar/Apr/May)が生成されうるため
    // ヒットした全monthly_tasksを更新する
    let linkedMonthlyTasks: { id: string }[] = [];
    if (task.name && task.season && task.year) {
      const { data: allRelatedSts } = await supabaseAdmin
        .from('course_prep_schedule_tasks')
        .select('id')
        .eq('name', task.name)
        .eq('season', task.season)
        .eq('year', task.year);

      const relatedIds = (allRelatedSts || []).map((s: { id: string }) => s.id);
      if (relatedIds.length > 0) {
        const { data: found } = await supabaseAdmin
          .from('monthly_tasks')
          .select('id')
          .in('linked_schedule_task_id', relatedIds)
          .eq('category', 'course');
        linkedMonthlyTasks = found || [];
      }
    }

    for (const linkedMonthlyTask of linkedMonthlyTasks) {
      const { data: existingCheck } = await supabaseAdmin
        .from('monthly_task_checks')
        .select('id')
        .eq('task_id', linkedMonthlyTask.id)
        .eq('school_id', schoolId)
        .maybeSingle();

      if (existingCheck) {
        await supabaseAdmin
          .from('monthly_task_checks')
          .update({
            is_completed: allCompleted,
            completed_at: allCompleted ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingCheck.id);
      } else if (allCompleted) {
        await supabaseAdmin.from('monthly_task_checks').insert({
          task_id: linkedMonthlyTask.id,
          school_id: schoolId,
          is_completed: true,
          completed_at: new Date().toISOString(),
        });
      }
    }
  }
}

async function handleUpdateScheduleTask(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { taskId: string; updates: Record<string, unknown> }
) {
  // IDOR 対策: 対象タスクが当該 schoolId のものか先に検証する。
  // この後の deadline/monthly_task 同期処理が taskId 起点で他教室データに波及しうるため、
  // school 不一致なら早期に 404 を返して以降の処理を実行しない。
  const { data: ownerCheck } = await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .select('school_id')
    .eq('id', params.taskId)
    .maybeSingle();
  if (!ownerCheck || String(ownerCheck.school_id) !== String(schoolId)) {
    return NextResponse.json({ error: 'タスクが見つかりません' }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .update({ ...params.updates, updated_at: new Date().toISOString() })
    .eq('id', params.taskId)
    .eq('school_id', schoolId);

  if (error)
    return apiErrorResponse(
      error,
      { route: 'POST /api/courses/prep', action: 'update_schedule_task', schoolId },
      '工程表タスクの更新に失敗しました。時間をおいて再度お試しください。'
    );

  // 期日同期: end_date が更新された場合、リンク先の進捗項目の deadline も同期
  if (params.updates.end_date !== undefined) {
    try {
      const { data: task } = await supabaseAdmin
        .from('course_prep_schedule_tasks')
        .select('linked_progress_item_id')
        .eq('id', params.taskId)
        .single();

      if (task?.linked_progress_item_id) {
        await supabaseAdmin
          .from('course_prep_progress_items')
          .update({
            deadline: params.updates.end_date as string | null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', task.linked_progress_item_id);
      }
    } catch (syncErr) {
      console.error('[courses/prep] deadline sync (schedule→progress) error:', syncErr);
    }
  }

  // リンク設定時: スケジュールタスクの end_date を進捗項目の deadline に同期
  if (
    params.updates.linked_progress_item_id !== undefined &&
    params.updates.end_date === undefined
  ) {
    try {
      const linkedId = params.updates.linked_progress_item_id as string | null;
      if (linkedId) {
        const { data: task } = await supabaseAdmin
          .from('course_prep_schedule_tasks')
          .select('end_date')
          .eq('id', params.taskId)
          .single();

        if (task?.end_date) {
          await supabaseAdmin
            .from('course_prep_progress_items')
            .update({
              deadline: task.end_date,
              updated_at: new Date().toISOString(),
            })
            .eq('id', linkedId);
        }
      }
    } catch (syncErr) {
      console.error('[courses/prep] deadline sync (link) error:', syncErr);
    }
  }

  // 双方向同期: is_completed が更新された場合、連動する monthly_task_checks も更新
  if (params.updates.is_completed !== undefined) {
    try {
      // 更新されたスケジュールタスクの情報を取得
      const { data: scheduleTask } = await supabaseAdmin
        .from('course_prep_schedule_tasks')
        .select('name, season, year, school_id')
        .eq('id', params.taskId)
        .single();

      if (scheduleTask) {
        // 同名の全教室のスケジュールタスクIDを取得
        const { data: allRelatedSts } = await supabaseAdmin
          .from('course_prep_schedule_tasks')
          .select('id')
          .eq('name', scheduleTask.name)
          .eq('season', scheduleTask.season)
          .eq('year', scheduleTask.year);

        const relatedIds = (allRelatedSts || []).map((s: { id: string }) => s.id);

        // linked_schedule_task_id がいずれかのIDに一致する月次タスクを検索
        // 同じschedule_taskから複数月(Feb/Mar/Apr/May)のmonthly_tasksが生成されうるため全件処理する
        const { data: linkedTasks } =
          relatedIds.length > 0
            ? await supabaseAdmin
                .from('monthly_tasks')
                .select('id')
                .in('linked_schedule_task_id', relatedIds)
                .eq('category', 'course')
            : { data: [] as { id: string }[] };

        const isCompleted = params.updates.is_completed as boolean;
        for (const linkedTask of linkedTasks || []) {
          const { data: existing } = await supabaseAdmin
            .from('monthly_task_checks')
            .select('id')
            .eq('task_id', linkedTask.id)
            .eq('school_id', scheduleTask.school_id)
            .maybeSingle();

          if (existing) {
            await supabaseAdmin
              .from('monthly_task_checks')
              .update({
                is_completed: isCompleted,
                completed_at: isCompleted ? new Date().toISOString() : null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existing.id);
          } else {
            await supabaseAdmin.from('monthly_task_checks').insert({
              task_id: linkedTask.id,
              school_id: scheduleTask.school_id,
              is_completed: isCompleted,
              completed_at: isCompleted ? new Date().toISOString() : null,
            });
          }
        }
      }
    } catch (syncErr) {
      console.error('[courses/prep] monthly_task sync error:', syncErr);
    }
  }

  return NextResponse.json({ success: true });
}

async function handleDeleteScheduleTask(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { taskId: string }
) {
  // IDOR 対策: 当該 schoolId のタスクのみ削除可能にする
  const { error } = await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .delete()
    .eq('id', params.taskId)
    .eq('school_id', schoolId);

  if (error)
    return apiErrorResponse(
      error,
      { route: 'POST /api/courses/prep', action: 'delete_schedule_task', schoolId },
      '工程表タスクの削除に失敗しました。時間をおいて再度お試しください。'
    );
  return NextResponse.json({ success: true });
}

// ===== 工程表マーカー =====

async function handleUpsertScheduleMarker(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { taskId: string; markerDate: string; label: string; color?: string }
) {
  // マーカーは school_id を持たず親タスク経由でスコープされるため、
  // 親タスクが当該 schoolId のものであることを検証する（IDOR 対策）
  const { data: parentTask } = await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .select('school_id')
    .eq('id', params.taskId)
    .maybeSingle();
  if (!parentTask || String(parentTask.school_id) !== String(schoolId)) {
    return NextResponse.json({ error: 'タスクが見つかりません' }, { status: 404 });
  }

  const { data: existing } = await supabaseAdmin
    .from('course_prep_schedule_markers')
    .select('id')
    .eq('task_id', params.taskId)
    .eq('marker_date', params.markerDate)
    .maybeSingle();

  if (existing) {
    const { error } = await supabaseAdmin
      .from('course_prep_schedule_markers')
      .update({
        label: params.label,
        color: params.color || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error)
      return apiErrorResponse(
        error,
        { route: 'POST /api/courses/prep', action: 'upsert_schedule_marker:update', schoolId },
        '工程表マーカーの更新に失敗しました。時間をおいて再度お試しください。'
      );
  } else {
    const { error } = await supabaseAdmin.from('course_prep_schedule_markers').insert({
      task_id: params.taskId,
      marker_date: params.markerDate,
      label: params.label,
      color: params.color || null,
    });
    if (error)
      return apiErrorResponse(
        error,
        { route: 'POST /api/courses/prep', action: 'upsert_schedule_marker:insert', schoolId },
        '工程表マーカーの追加に失敗しました。時間をおいて再度お試しください。'
      );
  }

  return NextResponse.json({ success: true });
}

async function handleDeleteScheduleMarker(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { taskId: string; markerDate: string }
) {
  // 親タスクが当該 schoolId のものか検証してから削除（IDOR 対策）
  const { data: parentTask } = await supabaseAdmin
    .from('course_prep_schedule_tasks')
    .select('school_id')
    .eq('id', params.taskId)
    .maybeSingle();
  if (!parentTask || String(parentTask.school_id) !== String(schoolId)) {
    return NextResponse.json({ error: 'タスクが見つかりません' }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from('course_prep_schedule_markers')
    .delete()
    .eq('task_id', params.taskId)
    .eq('marker_date', params.markerDate);

  if (error)
    return apiErrorResponse(
      error,
      { route: 'POST /api/courses/prep', action: 'delete_schedule_marker', schoolId },
      '工程表マーカーの削除に失敗しました。時間をおいて再度お試しください。'
    );
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
    // 進捗項目: 生徒実績以外の全フィールドを保存
    const { data, error } = await supabaseAdmin
      .from('course_prep_progress_items')
      .select(
        'name, column_type, sort_order, column_group, auto_source, manager_only, deadline, is_hidden'
      )
      .eq('school_id', schoolId)
      .eq('season', season)
      .eq('year', year)
      .order('sort_order');
    if (error)
      return apiErrorResponse(
        error,
        { route: 'POST /api/courses/prep', action: 'save_template:read_progress_items', schoolId },
        'テンプレートの保存に失敗しました（進捗管理項目を読み取れませんでした）。時間をおいて再度お試しください。'
      );
    templateData = (data || []) as Record<string, unknown>[];
  } else {
    // スケジュールタスク: 全フィールド + マーカー + リンク先進捗項目名を保存
    const { data: tasks, error } = await supabaseAdmin
      .from('course_prep_schedule_tasks')
      .select(
        'id, major_category, name, description, sort_order, start_date, end_date, deadline, linked_progress_item_id'
      )
      .eq('school_id', schoolId)
      .eq('season', season)
      .eq('year', year)
      .order('sort_order');
    if (error)
      return apiErrorResponse(
        error,
        { route: 'POST /api/courses/prep', action: 'save_template:read_schedule_tasks', schoolId },
        'テンプレートの保存に失敗しました（工程表タスクを読み取れませんでした）。時間をおいて再度お試しください。'
      );

    // マーカーを取得
    const taskIds = (tasks || []).map((t: { id: string }) => t.id);
    const markersMap: Record<
      string,
      Array<{ marker_date: string; label: string; color: string | null }>
    > = {};
    if (taskIds.length > 0) {
      const { data: markers } = await supabaseAdmin
        .from('course_prep_schedule_markers')
        .select('task_id, marker_date, label, color')
        .in('task_id', taskIds)
        .order('marker_date');
      for (const m of (markers || []) as Array<{
        task_id: string;
        marker_date: string;
        label: string;
        color: string | null;
      }>) {
        if (!markersMap[m.task_id]) markersMap[m.task_id] = [];
        markersMap[m.task_id].push({ marker_date: m.marker_date, label: m.label, color: m.color });
      }
    }

    // リンク先進捗項目のIDを名前に変換（別の期/年でも復元可能にする）
    const linkedItemIds = (tasks || [])
      .map((t: { linked_progress_item_id: string | null }) => t.linked_progress_item_id)
      .filter(Boolean) as string[];
    const itemNameMap: Record<string, string> = {};
    if (linkedItemIds.length > 0) {
      const { data: linkedItems } = await supabaseAdmin
        .from('course_prep_progress_items')
        .select('id, name')
        .in('id', linkedItemIds);
      for (const li of (linkedItems || []) as Array<{ id: string; name: string }>) {
        itemNameMap[li.id] = li.name;
      }
    }

    templateData = (tasks || []).map(
      (t: {
        id: string;
        major_category: string;
        name: string;
        description: string | null;
        sort_order: number;
        start_date: string | null;
        end_date: string | null;
        deadline: string | null;
        linked_progress_item_id: string | null;
      }) => ({
        major_category: t.major_category,
        name: t.name,
        description: t.description,
        sort_order: t.sort_order,
        start_date: t.start_date,
        end_date: t.end_date,
        deadline: t.deadline,
        linked_progress_item_name: t.linked_progress_item_id
          ? itemNameMap[t.linked_progress_item_id] || null
          : null,
        markers: markersMap[t.id] || [],
      })
    );
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

  if (error)
    return apiErrorResponse(
      error,
      { route: 'POST /api/courses/prep', action: 'save_template:insert', schoolId },
      'テンプレートの保存に失敗しました。時間をおいて再度お試しください。'
    );
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

  if (error)
    return apiErrorResponse(
      error,
      { route: 'POST /api/courses/prep', action: 'delete_template' },
      'テンプレートの削除に失敗しました。時間をおいて再度お試しください。'
    );
  return NextResponse.json({ success: true });
}

// ===== 進捗表まるごとの削除 =====

/**
 * 進捗表（school × season × year）に何が入っているかを数える。
 *
 * 削除ダイアログが「何が消えるのか」を実データで見せるために使う。画面が持っている
 * items は「非表示項目も表示」のチェック次第で欠けるため、消える件数はサーバーで数える。
 */
async function countProgressTable(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  season: string,
  year: number
): Promise<{ itemIds: string[]; progressCount: number; hasPeriod: boolean; linkedTasks: number }> {
  const [{ data: items }, { data: period }] = await Promise.all([
    supabaseAdmin
      .from('course_prep_progress_items')
      .select('id')
      .eq('school_id', schoolId)
      .eq('season', season)
      .eq('year', year),
    supabaseAdmin
      .from('course_prep_periods')
      .select('id')
      .eq('school_id', schoolId)
      .eq('season', season)
      .eq('year', year)
      .maybeSingle(),
  ]);

  const itemIds = ((items || []) as { id: string }[]).map((i) => i.id);
  if (itemIds.length === 0) {
    return { itemIds, progressCount: 0, hasPeriod: !!period, linkedTasks: 0 };
  }

  const [{ count: progressCount }, { count: linkedTasks }] = await Promise.all([
    // 入力済みセル数。head:true なので 1000 行上限の切り捨ては効かない（件数だけを取る）。
    supabaseAdmin
      .from('course_prep_student_progress')
      .select('id', { count: 'exact', head: true })
      .in('item_id', itemIds),
    // 工程表側からリンクされているタスク数（消えはしないがリンクが外れる旨を警告するため）
    supabaseAdmin
      .from('course_prep_schedule_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .in('linked_progress_item_id', itemIds),
  ]);

  return {
    itemIds,
    progressCount: progressCount || 0,
    hasPeriod: !!period,
    linkedTasks: linkedTasks || 0,
  };
}

/**
 * 進捗表（school × season × year）をまるごと削除する。取り消しはできない。
 *
 * 消えるもの:
 *   - course_prep_progress_items（列の定義）
 *   - course_prep_student_progress（生徒×項目のセル。item_id の ON DELETE CASCADE で連鎖削除）
 *   - course_prep_periods（予算コマ・目標・講習期間などの期間メタ）
 *
 * 消さないもの: course_prep_schedule_tasks（工程表は別画面の資産なので巻き添えにしない）。
 *   進捗項目にリンクしていたタスクは linked_progress_item_id が SET NULL になり、リンクだけ外れる。
 */
async function handleDeleteProgressTable(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { season: string; year: number }
) {
  const { season, year } = params;
  if (!season || !year) {
    return NextResponse.json({ error: 'season と year が必要です' }, { status: 400 });
  }

  // 削除後は数えられないので、実績値は消す前に確定させておく
  const before = await countProgressTable(supabaseAdmin, schoolId, season, year);

  const { error: itemsError } = await supabaseAdmin
    .from('course_prep_progress_items')
    .delete()
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year);
  if (itemsError) {
    return apiErrorResponse(
      itemsError,
      { route: 'POST /api/courses/prep', action: 'delete_progress_table:items', schoolId },
      '進捗表の削除に失敗しました。時間をおいて再度お試しください。'
    );
  }

  const { error: periodError } = await supabaseAdmin
    .from('course_prep_periods')
    .delete()
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year);
  if (periodError) {
    // 項目は消えているので、期間メタだけ残った中途半端な状態を隠さず伝える
    // DB 由来の文言は返さず、どこまで進んだかだけを伝える
    return apiErrorResponse(
      periodError,
      { route: 'POST /api/courses/prep', action: 'delete_progress_table:period', schoolId },
      '進捗管理項目は削除しましたが、期間設定の削除に失敗しました。時間をおいて再度お試しください。'
    );
  }

  return NextResponse.json({
    success: true,
    deleted: {
      items: before.itemIds.length,
      student_progress: before.progressCount,
      period: before.hasPeriod ? 1 : 0,
      unlinked_schedule_tasks: before.linkedTasks,
    },
  });
}

// ===== 講習期間メタ =====

async function handleUpsertPeriod(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: {
    season: string;
    year: number;
    budgetKoma?: number;
    targetKoma?: number;
    expectedRate?: number;
    scheduleStartDate?: string;
    scheduleEndDate?: string;
    // 講習申込の公開設定（Q4・決定26/29/44）。渡されたときだけ教室長以上を要求する。
    applyPublishStart?: string | null;
    applyPublishEnd?: string | null;
    applyPriceTable?: unknown;
    scheduleEndByGrade?: unknown;
  },
  role: string
) {
  const { data: existing } = await supabaseAdmin
    .from('course_prep_periods')
    .select('id, schedule_start_date')
    .eq('school_id', schoolId)
    .eq('season', params.season)
    .eq('year', params.year)
    .maybeSingle();

  const updateData: Record<string, unknown> = {};
  if (params.budgetKoma !== undefined) updateData.budget_koma = params.budgetKoma;
  if (params.targetKoma !== undefined) updateData.target_koma = params.targetKoma;
  if (params.expectedRate !== undefined) updateData.expected_rate = params.expectedRate;
  if (params.scheduleStartDate !== undefined)
    updateData.schedule_start_date = params.scheduleStartDate;
  if (params.scheduleEndDate !== undefined) updateData.schedule_end_date = params.scheduleEndDate;

  // ---- 講習申込の公開設定（§10-4） ----
  // このAPIの認可は「その教室にアクセスできるか」までで、講師も通る。
  // 公開期間と単価は保護者に見える面を直接動かすので、ここだけ教室長以上に絞る（§12のロールガード）。
  const touchesApplySettings =
    params.applyPublishStart !== undefined ||
    params.applyPublishEnd !== undefined ||
    params.applyPriceTable !== undefined ||
    params.scheduleEndByGrade !== undefined;

  if (touchesApplySettings) {
    const roleLower = (role || '').toLowerCase();
    if (roleLower !== 'admin' && roleLower !== 'owner' && roleLower !== 'manager') {
      return NextResponse.json(
        { error: '講習申込の公開設定は教室長以上のみ変更できます' },
        { status: 403 }
      );
    }

    // 公開期間は開始・終了をセットで扱う（片方だけだと「公開したつもりで非公開」になる）
    if (params.applyPublishStart !== undefined || params.applyPublishEnd !== undefined) {
      const win = validatePublishWindow(
        params.applyPublishStart ?? null,
        params.applyPublishEnd ?? null
      );
      if (!win.ok) return validationError(win.message);
      updateData.apply_publish_start = win.value.start;
      updateData.apply_publish_end = win.value.end;
    }

    if (params.applyPriceTable !== undefined) {
      const table = sanitizePriceTable(params.applyPriceTable);
      if (!table.ok) return validationError(table.message);
      updateData.apply_price_table = table.value;
    }

    if (params.scheduleEndByGrade !== undefined) {
      // 開始日は「今回の更新値 → 既存値」の順で見る（同一保存で開始日も変えたケースに追随する）
      const startForCheck =
        (params.scheduleStartDate as string | undefined) ??
        (existing as { schedule_start_date?: string | null } | null)?.schedule_start_date ??
        null;
      const byGrade = sanitizeEndByGrade(params.scheduleEndByGrade, startForCheck);
      if (!byGrade.ok) return validationError(byGrade.message);
      updateData.schedule_end_by_grade = byGrade.value;
    }
  }

  if (existing) {
    const { error } = await supabaseAdmin
      .from('course_prep_periods')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error)
      return apiErrorResponse(
        error,
        { route: 'POST /api/courses/prep', action: 'upsert_period:update', schoolId },
        '講習期間の設定の保存に失敗しました。時間をおいて再度お試しください。'
      );
  } else {
    const { error } = await supabaseAdmin.from('course_prep_periods').insert({
      school_id: schoolId,
      season: params.season,
      year: params.year,
      ...updateData,
    });
    if (error)
      return apiErrorResponse(
        error,
        { route: 'POST /api/courses/prep', action: 'upsert_period:insert', schoolId },
        '講習期間の設定の保存に失敗しました。時間をおいて再度お試しください。'
      );
  }

  return NextResponse.json({ success: true });
}
