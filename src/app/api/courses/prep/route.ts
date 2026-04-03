import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getApiAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/** 期間内の各曜日の出現回数を正確にカウント (0=日〜6=土) */
function countDayOccurrences(startDate: string, endDate: string): Record<number, number> {
  const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    counts[d.getDay()]++;
  }
  return counts;
}

/**
 * 科目別 proposal_count 集計
 * student_textbooks → textbooks.subject → student_progress.proposal_count
 * グループ先頭のみ集計（重複防止: updateGroupCounts() の仕様に準拠）
 *
 * 返り値: { [studentId]: { [subject]: totalProposalCount } }
 */
async function fetchSubjectProposals(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  season: string
): Promise<Record<string, Record<string, number>>> {
  try {
    // 1. student_textbooks を season で取得
    const { data: studentTextbooks, error: stError } = await supabaseAdmin
      .from('student_textbooks')
      .select('id, student_id, textbook_id')
      .eq('school_id', schoolId)
      .eq('season', season)
      .eq('is_active', true);

    if (stError) {
      console.warn('[fetchSubjectProposals] student_textbooks query error:', stError.message);
      return {};
    }
    if (!studentTextbooks || studentTextbooks.length === 0) return {};

    // 2. textbook の subject を取得
    const textbookIds = Array.from(new Set(
      (studentTextbooks as { textbook_id: number }[]).map((st) => st.textbook_id)
    ));
    const { data: textbooks, error: tbError } = await supabaseAdmin
      .from('textbooks')
      .select('id, subject')
      .in('id', textbookIds);

    if (tbError) {
      console.warn('[fetchSubjectProposals] textbooks query error:', tbError.message);
      return {};
    }

    const subjectMap = new Map<number, string>();
    for (const t of (textbooks || []) as { id: number; subject: string }[]) {
      if (t.subject) subjectMap.set(t.id, t.subject);
    }

    // student_textbook_id → { student_id, subject }
    const stInfoMap = new Map<string, { student_id: string; subject: string }>();
    for (const st of studentTextbooks as { id: string; student_id: string; textbook_id: number }[]) {
      const subject = subjectMap.get(st.textbook_id);
      if (subject) {
        stInfoMap.set(st.id, { student_id: st.student_id, subject });
      }
    }

    if (stInfoMap.size === 0) return {};

    // 3. student_progress の proposal_count を取得（proposal_count > 0 のみ）
    const stIds = Array.from(stInfoMap.keys());

    // Supabase .in() は最大数百件まで安全。大量の場合はバッチ分割
    const BATCH_SIZE = 500;
    type ProgressRow = {
      student_textbook_id: string;
      proposal_count: number | null;
      group_number: number | null;
      curriculum_item_id: string;
    };
    const allProgressData: ProgressRow[] = [];

    for (let i = 0; i < stIds.length; i += BATCH_SIZE) {
      const batch = stIds.slice(i, i + BATCH_SIZE);
      const { data, error: pError } = await supabaseAdmin
        .from('student_progress')
        .select('student_textbook_id, proposal_count, group_number, curriculum_item_id')
        .in('student_textbook_id', batch)
        .gt('proposal_count', 0);

      if (pError) {
        console.warn('[fetchSubjectProposals] student_progress query error:', pError.message);
        continue;
      }
      if (data) allProgressData.push(...(data as ProgressRow[]));
    }

    if (allProgressData.length === 0) return {};

    // 4. student_textbook_id ごとにグルーピング
    const grouped = new Map<string, ProgressRow[]>();
    for (const row of allProgressData) {
      const key = row.student_textbook_id;
      const arr = grouped.get(key);
      if (arr) arr.push(row);
      else grouped.set(key, [row]);
    }

    // 5. グループ先頭のみ集計して student_id × subject で合算
    const result: Record<string, Record<string, number>> = {};

    grouped.forEach((rows, stId) => {
      const info = stInfoMap.get(stId);
      if (!info) return;

      // グループ重複防止: group_number が同じ items は最小 curriculum_item_id のみカウント
      // (updateGroupCounts() が先頭にだけ値をセットする仕様に準拠)
      const groupLeaders = new Map<number, string>(); // group_number → min curriculum_item_id
      for (const row of rows) {
        if (row.group_number != null) {
          const existing = groupLeaders.get(row.group_number);
          if (!existing || row.curriculum_item_id < existing) {
            groupLeaders.set(row.group_number, row.curriculum_item_id);
          }
        }
      }

      let subjectTotal = 0;
      for (const row of rows) {
        if (!row.proposal_count) continue;
        // グループに属する場合、先頭以外はスキップ
        if (row.group_number != null) {
          if (groupLeaders.get(row.group_number) !== row.curriculum_item_id) continue;
        }
        subjectTotal += row.proposal_count;
      }

      if (subjectTotal > 0) {
        if (!result[info.student_id]) result[info.student_id] = {};
        result[info.student_id][info.subject] =
          (result[info.student_id][info.subject] || 0) + subjectTotal;
      }
    });

    return result;
  } catch (err) {
    console.error('[fetchSubjectProposals] unexpected error:', err);
    return {};
  }
}

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

        // リンクされた進捗項目の進捗率を計算
        const linkedItemIds = tasks
          .map((t: { linked_progress_item_id: string | null }) => t.linked_progress_item_id)
          .filter((id: string | null): id is string => !!id);

        const progressRateMap: Record<string, { total: number; completed: number }> = {};
        if (linkedItemIds.length > 0) {
          const uniqueItemIds = Array.from(new Set(linkedItemIds));
          const { data: progressData } = await supabaseAdmin
            .from('course_prep_student_progress')
            .select('item_id, status')
            .in('item_id', uniqueItemIds);

          for (const itemId of uniqueItemIds) {
            const related = (progressData || []).filter((p: { item_id: string }) => p.item_id === itemId);
            const completed = related.filter((p: { status: string }) => p.status === 'completed').length;
            progressRateMap[itemId] = { total: related.length, completed };
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

      case 'get_auto_values': {
        // 通塾日程から通常週回数を計算、講習期間から講習回数を正確に計算
        const periodSeason = season;

        // 1. 通常パターン（曜日付き）
        const { data: regularPatterns } = await supabaseAdmin
          .from('schedule_regular_patterns')
          .select('student_id, day_of_week')
          .eq('school_id', schoolId)
          .eq('period_type', 'regular')
          .eq('is_active', true);

        // 週回数（曜日不問の総数）
        const regularWeeklyMap: Record<string, number> = {};
        // 曜日別パターン数（生徒→曜日→コマ数）
        const regularDayMap: Record<string, Record<number, number>> = {};
        for (const p of (regularPatterns || []) as { student_id: string; day_of_week: number }[]) {
          regularWeeklyMap[p.student_id] = (regularWeeklyMap[p.student_id] || 0) + 1;
          if (!regularDayMap[p.student_id]) regularDayMap[p.student_id] = {};
          regularDayMap[p.student_id][p.day_of_week] = (regularDayMap[p.student_id][p.day_of_week] || 0) + 1;
        }

        // 2. 季節別パターン（曜日付き）
        const { data: seasonalPatterns } = await supabaseAdmin
          .from('schedule_regular_patterns')
          .select('student_id, day_of_week')
          .eq('school_id', schoolId)
          .eq('period_type', periodSeason)
          .eq('is_active', true);

        const seasonalDayMap: Record<string, Record<number, number>> = {};
        for (const p of (seasonalPatterns || []) as { student_id: string; day_of_week: number }[]) {
          if (!seasonalDayMap[p.student_id]) seasonalDayMap[p.student_id] = {};
          seasonalDayMap[p.student_id][p.day_of_week] = (seasonalDayMap[p.student_id][p.day_of_week] || 0) + 1;
        }

        // 3. 講習期間の曜日別出現回数を正確にカウント
        const { data: periodData } = await supabaseAdmin
          .from('course_prep_periods')
          .select('schedule_start_date, schedule_end_date')
          .eq('school_id', schoolId)
          .eq('season', season)
          .eq('year', year)
          .maybeSingle();

        let dayCounts: Record<number, number> | null = null;
        if (periodData?.schedule_start_date && periodData?.schedule_end_date) {
          dayCounts = countDayOccurrences(periodData.schedule_start_date, periodData.schedule_end_date);
        }

        // course_sessions = Σ(各曜日のパターン数 × その曜日の期間内出現回数)
        const result: Record<string, { regular_weekly: number; course_sessions: number; subject_proposals?: Record<string, number> }> = {};
        const allStudentIds = Array.from(new Set([...Object.keys(regularWeeklyMap), ...Object.keys(seasonalDayMap)]));
        for (const sid of allStudentIds) {
          const weeklyCount = regularWeeklyMap[sid] || 0;
          // 季節別パターンがあればそちらを優先、なければ通常パターンを使用
          const dayMap = Object.keys(seasonalDayMap[sid] || {}).length > 0
            ? seasonalDayMap[sid]
            : regularDayMap[sid] || {};
          let sessions = 0;
          if (dayCounts) {
            for (const [day, patternCount] of Object.entries(dayMap)) {
              sessions += patternCount * (dayCounts[Number(day)] || 0);
            }
          } else {
            // 期間未設定時は週回数をそのまま返す
            sessions = Object.values(dayMap).reduce((s, c) => s + c, 0);
          }
          result[sid] = {
            regular_weekly: weeklyCount,
            course_sessions: sessions,
          };
        }

        // 科目別 proposal_count を集計して追加
        const subjectProposalMap = await fetchSubjectProposals(supabaseAdmin, schoolId, season);
        for (const sid of Object.keys(subjectProposalMap)) {
          if (!result[sid]) {
            result[sid] = { regular_weekly: 0, course_sessions: 0 };
          }
          result[sid].subject_proposals = subjectProposalMap[sid];
        }

        return NextResponse.json({ data: result });
      }

      // ===== バッチ取得: 複数データを1リクエストで取得 =====
      case 'batch_get': {
        const targets = (url.searchParams.get('targets') || '').split(',').filter(Boolean);
        const batchResult: Record<string, unknown> = {};
        const promises: Promise<void>[] = [];

        if (targets.includes('students')) {
          promises.push((async () => {
            const { data } = await supabaseAdmin
              .from('students')
              .select('*')
              .eq('school_id', schoolId)
              .is('deleted_at', null)
              .neq('status', 'withdrawn')
              .order('grade', { ascending: true })
              .order('last_name_kana', { ascending: true, nullsFirst: false })
              .order('first_name_kana', { ascending: true, nullsFirst: false });
            batchResult.students = data || [];
          })());
        }

        if (targets.includes('progress_items')) {
          promises.push((async () => {
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
            const { data } = await query;
            batchResult.progress_items = data || [];
          })());
        }

        if (targets.includes('student_progress')) {
          promises.push((async () => {
            const { data: items } = await supabaseAdmin
              .from('course_prep_progress_items')
              .select('id')
              .eq('school_id', schoolId)
              .eq('season', season)
              .eq('year', year);
            if (!items || items.length === 0) { batchResult.student_progress = []; return; }
            const itemIds = items.map((i: { id: string }) => i.id);
            const { data } = await supabaseAdmin
              .from('course_prep_student_progress')
              .select('*')
              .eq('school_id', schoolId)
              .in('item_id', itemIds);
            batchResult.student_progress = data || [];
          })());
        }

        if (targets.includes('period')) {
          promises.push((async () => {
            const { data } = await supabaseAdmin
              .from('course_prep_periods')
              .select('*')
              .eq('school_id', schoolId)
              .eq('season', season)
              .eq('year', year)
              .maybeSingle();
            batchResult.period = data;
          })());
        }

        if (targets.includes('auto_values')) {
          promises.push((async () => {
            const [{ data: regularPatterns }, { data: seasonalPatterns }, { data: periodForAuto }] = await Promise.all([
              supabaseAdmin.from('schedule_regular_patterns')
                .select('student_id, day_of_week')
                .eq('school_id', schoolId).eq('period_type', 'regular').eq('is_active', true),
              supabaseAdmin.from('schedule_regular_patterns')
                .select('student_id, day_of_week')
                .eq('school_id', schoolId).eq('period_type', season).eq('is_active', true),
              supabaseAdmin.from('course_prep_periods')
                .select('schedule_start_date, schedule_end_date')
                .eq('school_id', schoolId).eq('season', season).eq('year', year).maybeSingle(),
            ]);
            const regularWeeklyMap: Record<string, number> = {};
            const regularDayMap: Record<string, Record<number, number>> = {};
            for (const p of (regularPatterns || []) as { student_id: string; day_of_week: number }[]) {
              regularWeeklyMap[p.student_id] = (regularWeeklyMap[p.student_id] || 0) + 1;
              if (!regularDayMap[p.student_id]) regularDayMap[p.student_id] = {};
              regularDayMap[p.student_id][p.day_of_week] = (regularDayMap[p.student_id][p.day_of_week] || 0) + 1;
            }
            const seasonalDayMap: Record<string, Record<number, number>> = {};
            for (const p of (seasonalPatterns || []) as { student_id: string; day_of_week: number }[]) {
              if (!seasonalDayMap[p.student_id]) seasonalDayMap[p.student_id] = {};
              seasonalDayMap[p.student_id][p.day_of_week] = (seasonalDayMap[p.student_id][p.day_of_week] || 0) + 1;
            }
            let dayCounts: Record<number, number> | null = null;
            if (periodForAuto?.schedule_start_date && periodForAuto?.schedule_end_date) {
              dayCounts = countDayOccurrences(periodForAuto.schedule_start_date, periodForAuto.schedule_end_date);
            }
            const autoResult: Record<string, { regular_weekly: number; course_sessions: number; subject_proposals?: Record<string, number> }> = {};
            const allIds = Array.from(new Set([...Object.keys(regularWeeklyMap), ...Object.keys(seasonalDayMap)]));
            for (const sid of allIds) {
              const weeklyCount = regularWeeklyMap[sid] || 0;
              const dayMap = Object.keys(seasonalDayMap[sid] || {}).length > 0
                ? seasonalDayMap[sid]
                : regularDayMap[sid] || {};
              let sessions = 0;
              if (dayCounts) {
                for (const [day, patternCount] of Object.entries(dayMap)) {
                  sessions += patternCount * (dayCounts[Number(day)] || 0);
                }
              } else {
                sessions = Object.values(dayMap).reduce((s, c) => s + c, 0);
              }
              autoResult[sid] = {
                regular_weekly: weeklyCount,
                course_sessions: sessions,
              };
            }
            // 科目別 proposal_count を集計して追加
            const subjectProposalMap = await fetchSubjectProposals(supabaseAdmin, schoolId, season);
            for (const sid of Object.keys(subjectProposalMap)) {
              if (!autoResult[sid]) {
                autoResult[sid] = { regular_weekly: 0, course_sessions: 0 };
              }
              autoResult[sid].subject_proposals = subjectProposalMap[sid];
            }
            batchResult.auto_values = autoResult;
          })());
        }

        if (targets.includes('schedule_tasks')) {
          promises.push((async () => {
            const { data: tasks } = await supabaseAdmin
              .from('course_prep_schedule_tasks')
              .select('*')
              .eq('school_id', schoolId)
              .eq('season', season)
              .eq('year', year)
              .order('sort_order', { ascending: true });
            if (!tasks || tasks.length === 0) { batchResult.schedule_tasks = []; return; }
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
            const linkedItemIds = tasks
              .map((t: { linked_progress_item_id: string | null }) => t.linked_progress_item_id)
              .filter((id: string | null): id is string => !!id);
            const progressRateMap: Record<string, { total: number; completed: number }> = {};
            if (linkedItemIds.length > 0) {
              const uniqueIds = Array.from(new Set(linkedItemIds));
              const { data: progressData } = await supabaseAdmin
                .from('course_prep_student_progress')
                .select('item_id, status')
                .in('item_id', uniqueIds);
              for (const itemId of uniqueIds) {
                const related = (progressData || []).filter((p: { item_id: string }) => p.item_id === itemId);
                const completed = related.filter((p: { status: string }) => p.status === 'completed').length;
                progressRateMap[itemId] = { total: related.length, completed };
              }
            }
            batchResult.schedule_tasks = tasks.map((t: { id: string; linked_progress_item_id: string | null }) => ({
              ...t,
              markers: markersByTask.get(t.id) || [],
              linked_progress_rate: t.linked_progress_item_id ? progressRateMap[t.linked_progress_item_id] || null : null,
            }));
          })());
        }

        await Promise.all(promises);
        return NextResponse.json({ data: batchResult });
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
        return await handleUpdateStudentProgress(supabaseAdmin, { ...params, schoolId });
      case 'update_student_number':
        return await handleUpdateStudentNumber(supabaseAdmin, { ...params, schoolId });
      case 'update_student_date':
        return await handleUpdateStudentDate(supabaseAdmin, { ...params, schoolId });
      case 'update_progress_item':
        return await handleUpdateProgressItem(supabaseAdmin, params);
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
        return await handleHideProgressItem(supabaseAdmin, params);
      case 'delete_progress_item':
        return await handleDeleteProgressItem(supabaseAdmin, params);
      case 'create_schedule_task':
        return await handleCreateScheduleTask(supabaseAdmin, schoolId, params);
      case 'update_schedule_task':
        return await handleUpdateScheduleTask(supabaseAdmin, params);
      case 'batch_link_schedule_tasks': {
        // 複数タスクのリンク解除＋1件リンク設定を1リクエストで（N+1回→1回）
        const unlinkTaskIds = (params.unlinkTaskIds as string[]) || [];
        const linkTaskId = params.linkTaskId as string | null;
        const linkItemId = params.linkItemId as string | null;
        for (const tid of unlinkTaskIds) {
          await supabaseAdmin.from('course_prep_schedule_tasks')
            .update({ linked_progress_item_id: null })
            .eq('id', tid).eq('school_id', schoolId);
        }
        if (linkTaskId && linkItemId) {
          await supabaseAdmin.from('course_prep_schedule_tasks')
            .update({ linked_progress_item_id: linkItemId })
            .eq('id', linkTaskId).eq('school_id', schoolId);
        }
        return NextResponse.json({ success: true });
      }
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

  type ProgressTemplateItem = {
    name: string; column_type: string; sort_order: number;
    column_group?: string; auto_source?: string; manager_only?: boolean;
    deadline?: string; is_hidden?: boolean;
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

  type ScheduleTemplateTask = {
    major_category: string; name: string; description?: string; sort_order: number;
    start_date?: string; end_date?: string; deadline?: string;
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
    return NextResponse.json({ error: `適用失敗: ${insertError.message}` }, { status: 500 });
  }

  // マーカーを復元
  const sortOrderToId: Record<number, string> = {};
  for (const t of (insertedTasks || []) as Array<{ id: string; sort_order: number }>) {
    sortOrderToId[t.sort_order] = t.id;
  }

  const markerInserts: Array<{ task_id: string; marker_date: string; label: string; color: string | null }> = [];
  for (const task of tasks) {
    if (task.markers && task.markers.length > 0) {
      const taskId = sortOrderToId[task.sort_order];
      if (taskId) {
        for (const m of task.markers) {
          markerInserts.push({ task_id: taskId, marker_date: m.marker_date, label: m.label, color: m.color });
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
  params: { season: string; year: number; name: string; columnType: string; columnGroup?: string | null; autoSource?: string | null; sortOrder: number }
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

async function handleUpdateProgressItem(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { itemId: string; updates: Record<string, unknown> }
) {
  const allowed = ['name', 'column_type', 'deadline', 'auto_source', 'sort_order', 'column_group'];
  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in params.updates) filtered[key] = params.updates[key];
  }
  filtered.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('course_prep_progress_items')
    .update(filtered)
    .eq('id', params.itemId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
  params: { schoolId: string; studentId: string; itemId: string; status: string | null }
) {
  const { schoolId, studentId, itemId, status } = params;

  const { data: existing } = await supabaseAdmin
    .from('course_prep_student_progress')
    .select('id')
    .eq('student_id', studentId)
    .eq('item_id', itemId)
    .maybeSingle();

  // statusがnullの場合はレコード削除（空欄に戻す）
  if (!status) {
    if (existing) {
      const { error } = await supabaseAdmin
        .from('course_prep_student_progress')
        .delete()
        .eq('id', existing.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

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
  params: { season: string; year: number; majorCategory: string; name: string; description?: string; sortOrder: number; startDate?: string | null; endDate?: string | null }
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
      ...(params.startDate ? { start_date: params.startDate } : {}),
      ...(params.endDate ? { end_date: params.endDate } : {}),
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
    // 進捗項目: 生徒実績以外の全フィールドを保存
    const { data, error } = await supabaseAdmin
      .from('course_prep_progress_items')
      .select('name, column_type, sort_order, column_group, auto_source, manager_only, deadline, is_hidden')
      .eq('school_id', schoolId)
      .eq('season', season)
      .eq('year', year)
      .order('sort_order');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    templateData = (data || []) as Record<string, unknown>[];
  } else {
    // スケジュールタスク: 全フィールド + マーカー + リンク先進捗項目名を保存
    const { data: tasks, error } = await supabaseAdmin
      .from('course_prep_schedule_tasks')
      .select('id, major_category, name, description, sort_order, start_date, end_date, deadline, linked_progress_item_id')
      .eq('school_id', schoolId)
      .eq('season', season)
      .eq('year', year)
      .order('sort_order');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // マーカーを取得
    const taskIds = (tasks || []).map((t: { id: string }) => t.id);
    const markersMap: Record<string, Array<{ marker_date: string; label: string; color: string | null }>> = {};
    if (taskIds.length > 0) {
      const { data: markers } = await supabaseAdmin
        .from('course_prep_schedule_markers')
        .select('task_id, marker_date, label, color')
        .in('task_id', taskIds)
        .order('marker_date');
      for (const m of (markers || []) as Array<{ task_id: string; marker_date: string; label: string; color: string | null }>) {
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

    templateData = (tasks || []).map((t: { id: string; major_category: string; name: string; description: string | null; sort_order: number; start_date: string | null; end_date: string | null; deadline: string | null; linked_progress_item_id: string | null }) => ({
      major_category: t.major_category,
      name: t.name,
      description: t.description,
      sort_order: t.sort_order,
      start_date: t.start_date,
      end_date: t.end_date,
      deadline: t.deadline,
      linked_progress_item_name: t.linked_progress_item_id ? itemNameMap[t.linked_progress_item_id] || null : null,
      markers: markersMap[t.id] || [],
    }));
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
  params: { season: string; year: number; budgetKoma?: number; targetKoma?: number; expectedRate?: number; scheduleStartDate?: string; scheduleEndDate?: string }
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
  if (params.targetKoma !== undefined) updateData.target_koma = params.targetKoma;
  if (params.expectedRate !== undefined) updateData.expected_rate = params.expectedRate;
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
