import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getApiAuth } from '@/lib/api-auth';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';

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
 * 科目別 proposal コマ数集計
 *
 * 優先順位:
 *   1. seasonal_proposals + seasonal_proposal_units（提案書の koma_count）
 *   2. student_textbooks → student_progress.proposal_count（進行表の提案コマ）
 *
 * 同一生徒×科目は提案書データがあればそちらを優先し、なければ進行表を使用。
 *
 * 返り値: { [studentId]: { [subject]: totalProposalCount } }
 */
async function fetchSubjectProposals(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  season: string,
  year?: number
): Promise<{ proposed: Record<string, Record<string, number>>; applied: Record<string, Record<string, number>> }> {
  // proposed: 提案コマ（koma_count）の生徒×科目合計 / applied: 申込コマ（applied_koma）の生徒×科目合計
  const proposed: Record<string, Record<string, number>> = {};
  const applied: Record<string, Record<string, number>> = {};
  try {

    // ========== 1. 提案書ベース（seasonal_proposals + seasonal_proposal_units） ==========
    {
      let proposalQuery = supabaseAdmin
        .from('seasonal_proposals')
        .select('id, student_id, textbook_id')
        .eq('school_id', schoolId)
        .eq('season', season);

      if (year && year > 0) {
        proposalQuery = proposalQuery.eq('year', year);
      }

      const { data: proposals, error: pErr } = await proposalQuery;

      if (pErr) {
        console.warn('[fetchSubjectProposals] seasonal_proposals query error:', pErr.message);
      } else if (proposals && proposals.length > 0) {
        const tbIds = Array.from(new Set(
          (proposals as { textbook_id: number }[]).map((p) => p.textbook_id)
        ));
        const { data: textbooks } = await supabaseAdmin
          .from('textbooks')
          .select('id, subject')
          .in('id', tbIds);

        const subjectMap = new Map<number, string>();
        for (const t of (textbooks || []) as { id: number; subject: string }[]) {
          if (t.subject) subjectMap.set(t.id, t.subject);
        }

        const proposalIds = (proposals as { id: string }[]).map((p) => p.id);

        type UnitRow = { id: string; proposal_id: string; koma_count: number; group_id: number; applied_koma: number | null; applied_group_id: number };
        const allUnits: UnitRow[] = [];
        const seenUnitIds = new Set<string>();
        // 1 提案書あたり最大 ~55 ユニット。15 提案書/バッチで 1 クエリ最大 825 行に抑え、
        // PostgREST のデフォルト 1000 行上限の余裕内に収める。
        // .range() は ORDER BY 無しだとページ間重複が起きうるので使わない。id で dedup。
        const BATCH = 15;
        const batches: string[][] = [];
        for (let i = 0; i < proposalIds.length; i += BATCH) {
          batches.push(proposalIds.slice(i, i + BATCH));
        }
        // バッチ同士は独立なので逐次ではなく並列実行（往復レイテンシを削減）
        const batchResults = await Promise.all(
          batches.map((batch) =>
            supabaseAdmin
              .from('seasonal_proposal_units')
              .select('id, proposal_id, koma_count, group_id, applied_koma, applied_group_id')
              .in('proposal_id', batch)
              // 提案コマ・申込コマのどちらかが1以上の単元を取得（提案0・申込1の単元も拾う）
              .or('koma_count.gt.0,applied_koma.gt.0')
          )
        );
        for (const { data: units } of batchResults) {
          for (const u of (units ?? []) as UnitRow[]) {
            if (seenUnitIds.has(u.id)) continue;
            seenUnitIds.add(u.id);
            allUnits.push(u);
          }
        }

        const unitsByProposal = new Map<string, UnitRow[]>();
        for (const u of allUnits) {
          const arr = unitsByProposal.get(u.proposal_id);
          if (arr) arr.push(u);
          else unitsByProposal.set(u.proposal_id, [u]);
        }

        for (const proposal of proposals as { id: string; student_id: string; textbook_id: number }[]) {
          const subject = subjectMap.get(proposal.textbook_id);
          if (!subject) continue;

          const units = unitsByProposal.get(proposal.id) || [];

          // 提案コマ合計（group_id で1コマにまとめる）
          const seenGroups = new Set<number>();
          let proposedTotal = 0;
          // 申込コマ合計（applied_group_id で1コマにまとめる。提案結合とは別系統）
          const seenAppliedGroups = new Set<number>();
          let appliedTotal = 0;

          for (const u of units) {
            if (u.koma_count > 0) {
              if (u.group_id > 0) {
                if (!seenGroups.has(u.group_id)) {
                  seenGroups.add(u.group_id);
                  proposedTotal += u.koma_count;
                }
              } else {
                proposedTotal += u.koma_count;
              }
            }
            const ak = u.applied_koma ?? 0;
            if (ak > 0) {
              if (u.applied_group_id > 0) {
                if (!seenAppliedGroups.has(u.applied_group_id)) {
                  seenAppliedGroups.add(u.applied_group_id);
                  appliedTotal += ak;
                }
              } else {
                appliedTotal += ak;
              }
            }
          }

          if (proposedTotal > 0) {
            if (!proposed[proposal.student_id]) proposed[proposal.student_id] = {};
            proposed[proposal.student_id][subject] =
              (proposed[proposal.student_id][subject] || 0) + proposedTotal;
          }
          if (appliedTotal > 0) {
            if (!applied[proposal.student_id]) applied[proposal.student_id] = {};
            applied[proposal.student_id][subject] =
              (applied[proposal.student_id][subject] || 0) + appliedTotal;
          }
        }
      }
    }

    return { proposed, applied };
  } catch (err) {
    console.error('[fetchSubjectProposals] unexpected error:', err);
    return { proposed, applied };
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

          // 対象生徒数を母数にする
          const { count: studentCount } = await supabaseAdmin
            .from('students')
            .select('id', { count: 'exact', head: true })
            .eq('school_id', schoolId)
            .is('deleted_at', null);

          const totalStudents = studentCount || 0;

          const { data: progressData } = await supabaseAdmin
            .from('course_prep_student_progress')
            .select('item_id, status')
            .in('item_id', uniqueItemIds);

          for (const itemId of uniqueItemIds) {
            const related = (progressData || []).filter((p: { item_id: string }) => p.item_id === itemId);
            const completed = related.filter((p: { status: string }) => p.status === 'completed').length;
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
        const targets = (url.searchParams.get('targets') || '').split(',').filter(Boolean);
        const batchResult: Record<string, unknown> = {};
        const promises: Promise<void>[] = [];

        if (targets.includes('students')) {
          promises.push((async () => {
            // 大型校では 1000 名を超えうるため全件ページング取得。
            // 並び替えキーが一意でないので id を最終ソートキーに加えて安定化する。
            const data = await fetchAllPaged<Record<string, unknown>>((from, to) =>
              supabaseAdmin
                .from('students')
                .select('*')
                .eq('school_id', schoolId)
                .is('deleted_at', null)
                .neq('status', 'withdrawn')
                .order('grade', { ascending: true })
                .order('last_name_kana', { ascending: true, nullsFirst: false })
                .order('first_name_kana', { ascending: true, nullsFirst: false })
                .order('id', { ascending: true })
                .range(from, to)
            ).catch(() => []);
            batchResult.students = data;
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
            const { data } = await supabaseAdmin
              .from('course_prep_student_progress')
              .select('*, item:course_prep_progress_items!inner(school_id, season, year)')
              .eq('item.school_id', schoolId)
              .eq('item.season', season)
              .eq('item.year', year);
            batchResult.student_progress = (data || []).map(({ item: _item, ...rest }: { item: unknown; [key: string]: unknown }) => rest);
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
            // 通塾日程は (生徒数 × 曜日) でスケールし単一校でも 1000 行を超えうるため
            // 全件ページング取得する（切り捨てると一部生徒の自動コマ数計算が欠落する）。
            const [regularPatterns, seasonalPatterns, { data: periodForAuto }, proposalMaps] = await Promise.all([
              fetchAllPaged<{ student_id: string; day_of_week: number }>((from, to) =>
                supabaseAdmin.from('schedule_regular_patterns')
                  .select('student_id, day_of_week, id')
                  .eq('school_id', schoolId).eq('period_type', 'regular').eq('is_active', true)
                  .order('id', { ascending: true }).range(from, to)
              ).catch(() => []),
              fetchAllPaged<{ student_id: string; day_of_week: number }>((from, to) =>
                supabaseAdmin.from('schedule_regular_patterns')
                  .select('student_id, day_of_week, id')
                  .eq('school_id', schoolId).eq('period_type', season).eq('is_active', true)
                  .order('id', { ascending: true }).range(from, to)
              ).catch(() => []),
              supabaseAdmin.from('course_prep_periods')
                .select('schedule_start_date, schedule_end_date')
                .eq('school_id', schoolId).eq('season', season).eq('year', year).maybeSingle(),
              fetchSubjectProposals(supabaseAdmin, schoolId, season, year),
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
            const autoResult: Record<string, { regular_weekly: number; course_sessions: number; proposal_total?: number; subject_proposals?: Record<string, number>; applied_total?: number; subject_applied?: Record<string, number> }> = {};
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
            const proposalSids = Array.from(new Set([
              ...Object.keys(proposalMaps.proposed),
              ...Object.keys(proposalMaps.applied),
            ]));
            for (const sid of proposalSids) {
              if (!autoResult[sid]) {
                autoResult[sid] = { regular_weekly: 0, course_sessions: 0 };
              }
              const propSubjects = proposalMaps.proposed[sid];
              if (propSubjects) {
                autoResult[sid].subject_proposals = propSubjects;
                autoResult[sid].proposal_total = Object.values(propSubjects).reduce((a, b) => a + b, 0);
              }
              const appliedSubjects = proposalMaps.applied[sid];
              if (appliedSubjects) {
                autoResult[sid].subject_applied = appliedSubjects;
                autoResult[sid].applied_total = Object.values(appliedSubjects).reduce((a, b) => a + b, 0);
              }
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
            const linkedItemIds = tasks
              .map((t: { linked_progress_item_id: string | null }) => t.linked_progress_item_id)
              .filter((id: string | null): id is string => !!id);
            const uniqueLinkedIds = Array.from(new Set(linkedItemIds));

            const [{ data: markers }, studentCount, progressData] = await Promise.all([
              supabaseAdmin
                .from('course_prep_schedule_markers')
                .select('*')
                .in('task_id', taskIds)
                .order('marker_date', { ascending: true }),
              uniqueLinkedIds.length > 0
                ? supabaseAdmin
                    .from('students')
                    .select('id', { count: 'exact', head: true })
                    .eq('school_id', schoolId)
                    .is('deleted_at', null)
                    .neq('status', 'withdrawn')
                    .then(({ count }) => count || 0)
                : Promise.resolve(0),
              uniqueLinkedIds.length > 0
                ? supabaseAdmin
                    .from('course_prep_student_progress')
                    .select('item_id, status')
                    .in('item_id', uniqueLinkedIds)
                    .then(({ data }) => data || [])
                : Promise.resolve([]),
            ]);

            const markersByTask = new Map<string, unknown[]>();
            for (const m of (markers || [])) {
              const tid = (m as { task_id: string }).task_id;
              if (!markersByTask.has(tid)) markersByTask.set(tid, []);
              markersByTask.get(tid)!.push(m);
            }
            const progressRateMap: Record<string, { total: number; completed: number }> = {};
            for (const itemId of uniqueLinkedIds) {
              const related = (progressData as { item_id: string; status: string }[]).filter((p) => p.item_id === itemId);
              const completed = related.filter((p) => p.status === 'completed').length;
              progressRateMap[itemId] = { total: studentCount as number, completed };
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
          await supabaseAdmin.from('course_prep_schedule_tasks')
            .update({ linked_progress_item_id: null })
            .eq('id', tid).eq('school_id', schoolId);
        }
        if (linkTaskId && linkItemId) {
          await supabaseAdmin.from('course_prep_schedule_tasks')
            .update({ linked_progress_item_id: linkItemId })
            .eq('id', linkTaskId).eq('school_id', schoolId);

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
              await supabaseAdmin.from('course_prep_progress_items')
                .update({ deadline: taskDate, updated_at: new Date().toISOString() })
                .eq('id', linkItemId);
            } else if (!taskDate && itemDeadline) {
              await supabaseAdmin.from('course_prep_schedule_tasks')
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
      case 'delete_all_progress_items':
        return await handleDeleteAllProgressItems(supabaseAdmin, schoolId, params);
      case 'upsert_schedule_marker':
        return await handleUpsertScheduleMarker(supabaseAdmin, schoolId, params);
      case 'delete_schedule_marker':
        return await handleDeleteScheduleMarker(supabaseAdmin, schoolId, params);
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
    return NextResponse.json({ error: error.message }, { status: 500 });
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

  // statusがnullの場合はレコード削除（空欄に戻す）
  if (!status) {
    const { error } = await supabaseAdmin
      .from('course_prep_student_progress')
      .delete()
      .eq('school_id', schoolId)
      .eq('student_id', studentId)
      .eq('item_id', itemId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // UPSERT で更新する。SELECT→INSERT/UPDATE の非アトミック実装だと、
    // 同一セルを素早く連打（空欄→完了→対象外）した際に2リクエストが競合し、
    // (student_id,item_id) のユニーク制約違反（重複キー500）→画面全体の再読込が起きていた。
    const { error } = await supabaseAdmin
      .from('course_prep_student_progress')
      .upsert(
        { school_id: schoolId, student_id: studentId, item_id: itemId, status, updated_at: new Date().toISOString() },
        { onConflict: 'student_id,item_id' }
      );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
  const { error } = await supabaseAdmin
    .from('course_prep_student_progress')
    .upsert(
      { school_id: schoolId, student_id: studentId, item_id: itemId, number_value: numberValue, updated_at: new Date().toISOString() },
      { onConflict: 'student_id,item_id' }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

async function handleUpdateStudentDate(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  params: { schoolId: string; studentId: string; itemId: string; dateValue: string | null }
) {
  const { schoolId, studentId, itemId, dateValue } = params;

  // UPSERT（連打時の重複キー競合を回避）
  const { error } = await supabaseAdmin
    .from('course_prep_student_progress')
    .upsert(
      { school_id: schoolId, student_id: studentId, item_id: itemId, date_value: dateValue, updated_at: new Date().toISOString() },
      { onConflict: 'student_id,item_id' }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

// ===== 工程表タスク =====

async function handleCreateScheduleTask(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  params: { season: string; year: number; majorCategory: string; name: string; description?: string; sortOrder?: number; startDate?: string | null; endDate?: string | null }
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
    sortOrder = existing && existing.length > 0
      ? (existing[0] as { sort_order: number }).sort_order + 1
      : 0;
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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

  // 2 & 3. 生徒数と完了済み生徒数を並列取得（互いに独立しているため安全）
  const [{ count: totalStudents }, { count: completedCount }] = await Promise.all([
    supabaseAdmin
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .is('deleted_at', null),
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
        await supabaseAdmin
          .from('monthly_task_checks')
          .insert({
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
  if (params.updates.linked_progress_item_id !== undefined && params.updates.end_date === undefined) {
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
        const { data: linkedTasks } = relatedIds.length > 0
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
            await supabaseAdmin
              .from('monthly_task_checks')
              .insert({
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
