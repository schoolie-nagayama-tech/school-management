import { createClient } from '@supabase/supabase-js';
import { fetchAllPaged, fetchAllInChunks } from '@/lib/utils/supabasePaging';

/**
 * 講習準備（進捗管理表・工程表）のサーバー側データ取得を集めたモジュール。
 *
 * /api/courses/prep のルートから切り出したのは、確定保存（スナップショット）を
 * 日次 cron からも同じロジックで作れるようにするため。
 * ライブ表示と確定保存が別々の取得コードを持つと「保存した中身と画面に出ていた中身が違う」が
 * 静かに起きるので、取得は必ずこの runBatchForSchool を通す。
 *
 * 設計: docs/koushu-progress-snapshot-plan.md
 */

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
): Promise<{
  proposed: Record<string, Record<string, number>>;
  applied: Record<string, Record<string, number>>;
}> {
  // proposed: 提案コマ（koma_count）の生徒×科目合計 / applied: 申込コマ（applied_koma）の生徒×科目合計
  const proposed: Record<string, Record<string, number>> = {};
  const applied: Record<string, Record<string, number>> = {};
  try {
    // ========== 提案書ベース（seasonal_proposals + seasonal_proposal_units） ==========
    // 以前は proposals → textbooks → units(並列バッチ) と DB と 3 ラウンド往復していた。
    // 計測の結果 DB 自体は warm 数ms で速く、ボトルネックは往復回数。教科(textbook.subject)を
    // proposals に !inner 埋め込みして取得し、別建ての textbooks クエリ 1 往復を削減する（FK 済みで解決可能）。
    // units は 1000 行上限を超えるため全件を 1 クエリにできず、提案書ID単位の並列バッチ（1ラウンド）を維持する。

    // PostgREST の to-one 埋め込みはバージョンによりオブジェクト/配列のどちらでも返りうるので吸収する
    const firstOf = <T>(v: T | T[] | null | undefined): T | null =>
      Array.isArray(v) ? (v[0] ?? null) : (v ?? null);

    type ProposalRow = {
      id: string;
      student_id: string;
      textbook: { subject: string | null } | { subject: string | null }[] | null;
    };
    // 提案書は通常 1000 行未満だが、安全のためページングする（教科を埋め込んで往復を1つ削減）
    const proposals = await fetchAllPaged<ProposalRow>((from, to) => {
      let q = supabaseAdmin
        .from('seasonal_proposals')
        .select('id, student_id, textbook:textbooks!inner(subject)')
        .eq('school_id', schoolId)
        .eq('season', season)
        .order('id', { ascending: true })
        .range(from, to);
      if (year && year > 0) {
        q = q.eq('year', year);
      }
      return q;
    }).catch((err) => {
      console.warn('[fetchSubjectProposals] seasonal_proposals query error:', err);
      return [] as ProposalRow[];
    });

    if (proposals.length === 0) {
      return { proposed, applied };
    }

    // 提案書ID → { studentId, subject }。教科(subject)が無い提案書は集計対象外。
    const proposalInfo = new Map<string, { studentId: string; subject: string }>();
    for (const p of proposals) {
      const subject = firstOf(p.textbook)?.subject;
      if (!subject) continue;
      proposalInfo.set(p.id, { studentId: p.student_id, subject });
    }
    const proposalIds = Array.from(proposalInfo.keys());
    if (proposalIds.length === 0) {
      return { proposed, applied };
    }

    type UnitRow = {
      id: string;
      proposal_id: string;
      koma_count: number;
      group_id: number;
      applied_koma: number | null;
      applied_group_id: number;
    };
    // 1 提案書あたり最大 ~55 ユニット。15 提案書/バッチで 1 クエリ最大 825 行に抑え、
    // PostgREST のデフォルト 1000 行上限の余裕内に収める。バッチ同士は並列実行（往復は1ラウンド）。
    const BATCH = 15;
    const batches: string[][] = [];
    for (let i = 0; i < proposalIds.length; i += BATCH) {
      batches.push(proposalIds.slice(i, i + BATCH));
    }
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
    const unitsByProposal = new Map<string, UnitRow[]>();
    const seenUnitIds = new Set<string>();
    for (const { data: units } of batchResults) {
      for (const u of (units ?? []) as UnitRow[]) {
        if (seenUnitIds.has(u.id)) continue;
        seenUnitIds.add(u.id);
        const arr = unitsByProposal.get(u.proposal_id);
        if (arr) arr.push(u);
        else unitsByProposal.set(u.proposal_id, [u]);
      }
    }

    // proposal(=生徒×教科) 単位に集計する。group_id で提案コマを、
    // applied_group_id で申込コマを1コマに重複排除する（提案結合と申込結合は別系統）。
    for (const [proposalId, info] of Array.from(proposalInfo.entries())) {
      const units = unitsByProposal.get(proposalId) || [];
      const seenGroups = new Set<number>();
      let proposedTotal = 0;
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
        if (!proposed[info.studentId]) proposed[info.studentId] = {};
        proposed[info.studentId][info.subject] =
          (proposed[info.studentId][info.subject] || 0) + proposedTotal;
      }
      if (appliedTotal > 0) {
        if (!applied[info.studentId]) applied[info.studentId] = {};
        applied[info.studentId][info.subject] =
          (applied[info.studentId][info.subject] || 0) + appliedTotal;
      }
    }

    return { proposed, applied };
  } catch (err) {
    console.error('[fetchSubjectProposals] unexpected error:', err);
    return { proposed, applied };
  }
}

export function getSupabaseAdmin() {
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
 * 「この講習期間中に在籍していた生徒」に絞り込む共通フィルタ。
 *
 * 講習の実績は期が終わったあとに振り返るものなので、退塾しただけで行が消えると
 * 8月末退塾の生徒の夏期コマ数が9月に入った瞬間に実績から抜ける（退塾ステータスは
 * 退塾日の翌日に日次cronで切り替わる）。そのため「今いるか」ではなく
 * 「その期にいたか」で判定する。
 *
 * - periodStart があれば: 未退塾 or 退塾日が期間開始日以降 を残す
 * - periodStart が無ければ（期間未設定）: 在籍していた根拠が無いので従来どおり退塾者を除外
 * - status='withdrawn' なのに withdrawal_date が null の生徒も、根拠が無いので除外される
 *   （PostgREST の gte は null に一致しないため）
 */
export function enrolledDuringPeriodFilter(periodStart: string | null | undefined): string {
  // 日付形式が壊れていると or 句の構文ごと崩れるので、YYYY-MM-DD 以外は期間未設定として扱う。
  const valid = periodStart && /^\d{4}-\d{2}-\d{2}$/.test(periodStart) ? periodStart : null;
  return valid ? `status.neq.withdrawn,withdrawal_date.gte.${valid}` : 'status.neq.withdrawn';
}

// ===== 講習進捗のスナップショット（確定保存） =====
// 設計は docs/koushu-progress-snapshot-plan.md。
// 保存するのは「集計結果」ではなく「集計の入力」。computeDashboardAggregates の
// 引数5点セット（students / items / progress / autoValues / period）を凍結する。

/** payload の形式版。生徒の保存項目や構造を変えるときに上げる。 */
const SNAPSHOT_PAYLOAD_VERSION = 1;

/**
 * スナップショットに残す生徒の項目。
 * 進捗表・ダッシュボード・レポートが実際に使う項目だけに絞る（住所や連絡先は凍結物に増やさない）。
 * withdrawal_date は「その期に在籍していた／途中で辞めた」を後から説明するために持つ。
 */
const SNAPSHOT_STUDENT_FIELDS = [
  'id',
  'school_id',
  'grade',
  'last_name',
  'first_name',
  'last_name_kana',
  'first_name_kana',
  'status',
  'withdrawal_date',
] as const;

function pickSnapshotStudent(student: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of SNAPSHOT_STUDENT_FIELDS) {
    picked[key] = student[key] ?? null;
  }
  return picked;
}

/** 講習期間の開始日を引く。期が未作成／期間未設定なら null。 */
export async function fetchPeriodStart(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  season: string,
  year: number
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('course_prep_periods')
    .select('schedule_start_date')
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year)
    .maybeSingle();
  return (data?.schedule_start_date as string | null) ?? null;
}

/**
 * 1教室分の batch_get ロジック本体。
 * 既存の case 'batch_get' から per-school ロジックをそのまま抽出した関数で、
 * 単一校（batch_get）と複数校（batch_get_multi）の両方から呼び出される。
 * targets ごとに並列クエリを発行し、{ students, progress_items, ... } のマップを返す。
 */
export async function runBatchForSchool(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  season: string,
  year: number,
  includeHidden: boolean,
  targets: string[]
): Promise<Record<string, unknown>> {
  const batchResult: Record<string, unknown> = {};
  const promises: Promise<void>[] = [];

  // 期の設定は students / period / auto_values / schedule_tasks の4か所で要るので、
  // 遅延1回だけ引いて共有する（targets に応じて呼ばれなければクエリも飛ばない）。
  let periodPromise: Promise<Record<string, unknown> | null> | null = null;
  const getPeriod = () => {
    if (!periodPromise) {
      periodPromise = Promise.resolve(
        supabaseAdmin
          .from('course_prep_periods')
          .select('*')
          .eq('school_id', schoolId)
          .eq('season', season)
          .eq('year', year)
          .maybeSingle()
      ).then(({ data }) => (data as Record<string, unknown> | null) ?? null);
    }
    return periodPromise;
  };
  const getPeriodStart = async () =>
    ((await getPeriod())?.schedule_start_date as string | null | undefined) ?? null;

  if (targets.includes('students')) {
    promises.push(
      (async () => {
        const periodStart = await getPeriodStart();
        // 大型校では 1000 名を超えうるため全件ページング取得。
        // 並び替えキーが一意でないので id を最終ソートキーに加えて安定化する。
        const data = await fetchAllPaged<Record<string, unknown>>((from, to) =>
          supabaseAdmin
            .from('students')
            .select('*')
            .eq('school_id', schoolId)
            .is('deleted_at', null)
            .or(enrolledDuringPeriodFilter(periodStart))
            .neq('is_test', true) // 研修用テスト生徒は講習進捗に出さない
            .order('grade', { ascending: true })
            .order('last_name_kana', { ascending: true, nullsFirst: false })
            .order('first_name_kana', { ascending: true, nullsFirst: false })
            .order('id', { ascending: true })
            .range(from, to)
        ).catch(() => []);
        batchResult.students = data;
      })()
    );
  }

  if (targets.includes('progress_items')) {
    promises.push(
      (async () => {
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
      })()
    );
  }

  if (targets.includes('student_progress')) {
    promises.push(
      (async () => {
        // 進捗は (生徒 × 進捗項目) でスケールし、1校1シーズンで容易に1000行を超える。
        // 未ページングだと PostgREST の1000行上限で静かに切り捨てられ、あふれた分のセルが
        // 「保存したのにリロードで消える」ように見える（本番で発生）。必ず全件ページングする。
        const data = await fetchAllPaged<{ item: unknown; [key: string]: unknown }>((from, to) =>
          supabaseAdmin
            .from('course_prep_student_progress')
            .select('*, item:course_prep_progress_items!inner(school_id, season, year)')
            .eq('item.school_id', schoolId)
            .eq('item.season', season)
            .eq('item.year', year)
            .order('id', { ascending: true })
            .range(from, to)
        );
        batchResult.student_progress = data.map(({ item: _item, ...rest }) => rest);
      })()
    );
  }

  if (targets.includes('period')) {
    promises.push(
      (async () => {
        batchResult.period = await getPeriod();
      })()
    );
  }

  // この期が確定保存済みかどうかだけを返す。payload は重いので含めない
  // （実際に当時の姿を表示するときに get_snapshot で取りにいく）。
  if (targets.includes('snapshot_meta')) {
    promises.push(
      (async () => {
        const { data } = await supabaseAdmin
          .from('course_prep_snapshots')
          .select('id, captured_at, captured_by, capture_reason, student_count, summary')
          .eq('school_id', schoolId)
          .eq('season', season)
          .eq('year', year)
          .maybeSingle();
        batchResult.snapshot_meta = data ?? null;
      })()
    );
  }

  if (targets.includes('auto_values')) {
    promises.push(
      (async () => {
        // 通塾日程は (生徒数 × 曜日) でスケールし単一校でも 1000 行を超えうるため
        // 全件ページング取得する（切り捨てると一部生徒の自動コマ数計算が欠落する）。
        const [regularPatterns, seasonalPatterns, periodForAuto, proposalMaps] = await Promise.all([
          fetchAllPaged<{ student_id: string; day_of_week: number }>((from, to) =>
            supabaseAdmin
              .from('schedule_regular_patterns')
              .select('student_id, day_of_week, id')
              .eq('school_id', schoolId)
              .eq('period_type', 'regular')
              .eq('is_active', true)
              .order('id', { ascending: true })
              .range(from, to)
          ).catch(() => []),
          fetchAllPaged<{ student_id: string; day_of_week: number }>((from, to) =>
            supabaseAdmin
              .from('schedule_regular_patterns')
              .select('student_id, day_of_week, id')
              .eq('school_id', schoolId)
              .eq('period_type', season)
              .eq('is_active', true)
              .order('id', { ascending: true })
              .range(from, to)
          ).catch(() => []),
          getPeriod(),
          fetchSubjectProposals(supabaseAdmin, schoolId, season, year),
        ]);
        const regularWeeklyMap: Record<string, number> = {};
        const regularDayMap: Record<string, Record<number, number>> = {};
        for (const p of (regularPatterns || []) as { student_id: string; day_of_week: number }[]) {
          regularWeeklyMap[p.student_id] = (regularWeeklyMap[p.student_id] || 0) + 1;
          if (!regularDayMap[p.student_id]) regularDayMap[p.student_id] = {};
          regularDayMap[p.student_id][p.day_of_week] =
            (regularDayMap[p.student_id][p.day_of_week] || 0) + 1;
        }
        const seasonalDayMap: Record<string, Record<number, number>> = {};
        for (const p of (seasonalPatterns || []) as { student_id: string; day_of_week: number }[]) {
          if (!seasonalDayMap[p.student_id]) seasonalDayMap[p.student_id] = {};
          seasonalDayMap[p.student_id][p.day_of_week] =
            (seasonalDayMap[p.student_id][p.day_of_week] || 0) + 1;
        }
        let dayCounts: Record<number, number> | null = null;
        const autoStart = periodForAuto?.schedule_start_date as string | null | undefined;
        const autoEnd = periodForAuto?.schedule_end_date as string | null | undefined;
        if (autoStart && autoEnd) {
          dayCounts = countDayOccurrences(autoStart, autoEnd);
        }
        const autoResult: Record<
          string,
          {
            regular_weekly: number;
            course_sessions: number;
            proposal_total?: number;
            subject_proposals?: Record<string, number>;
            applied_total?: number;
            subject_applied?: Record<string, number>;
          }
        > = {};
        const allIds = Array.from(
          new Set([...Object.keys(regularWeeklyMap), ...Object.keys(seasonalDayMap)])
        );
        for (const sid of allIds) {
          const weeklyCount = regularWeeklyMap[sid] || 0;
          const dayMap =
            Object.keys(seasonalDayMap[sid] || {}).length > 0
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
        const proposalSids = Array.from(
          new Set([...Object.keys(proposalMaps.proposed), ...Object.keys(proposalMaps.applied)])
        );
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
            autoResult[sid].applied_total = Object.values(appliedSubjects).reduce(
              (a, b) => a + b,
              0
            );
          }
        }
        batchResult.auto_values = autoResult;
      })()
    );
  }

  if (targets.includes('schedule_tasks')) {
    promises.push(
      (async () => {
        const { data: tasks } = await supabaseAdmin
          .from('course_prep_schedule_tasks')
          .select('*')
          .eq('school_id', schoolId)
          .eq('season', season)
          .eq('year', year)
          .order('sort_order', { ascending: true });
        if (!tasks || tasks.length === 0) {
          batchResult.schedule_tasks = [];
          return;
        }
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
          // 母数は進捗表に出る生徒集合と揃える（期間中に在籍していた生徒）。
          uniqueLinkedIds.length > 0
            ? getPeriodStart().then((periodStart) =>
                supabaseAdmin
                  .from('students')
                  .select('id', { count: 'exact', head: true })
                  .eq('school_id', schoolId)
                  .is('deleted_at', null)
                  .or(enrolledDuringPeriodFilter(periodStart))
                  .neq('is_test', true) // 研修用テスト生徒は母数に含めない
                  .then(({ count }) => count || 0)
              )
            : Promise.resolve(0),
          // 1項目につき生徒数分の行が返るため1000行を超えうる。切り捨てると進捗率が過小になる。
          uniqueLinkedIds.length > 0
            ? fetchAllInChunks<{ item_id: string; status: string }>(
                uniqueLinkedIds,
                (chunk, from, to) =>
                  supabaseAdmin
                    .from('course_prep_student_progress')
                    .select('item_id, status')
                    .in('item_id', chunk)
                    .order('id', { ascending: true })
                    .range(from, to)
              )
            : Promise.resolve([]),
        ]);

        const markersByTask = new Map<string, unknown[]>();
        for (const m of markers || []) {
          const tid = (m as { task_id: string }).task_id;
          if (!markersByTask.has(tid)) markersByTask.set(tid, []);
          markersByTask.get(tid)!.push(m);
        }
        const progressRateMap: Record<string, { total: number; completed: number }> = {};
        for (const itemId of uniqueLinkedIds) {
          const related = (progressData as { item_id: string; status: string }[]).filter(
            (p) => p.item_id === itemId
          );
          const completed = related.filter((p) => p.status === 'completed').length;
          progressRateMap[itemId] = { total: studentCount as number, completed };
        }
        batchResult.schedule_tasks = tasks.map(
          (t: { id: string; linked_progress_item_id: string | null }) => ({
            ...t,
            markers: markersByTask.get(t.id) || [],
            linked_progress_rate: t.linked_progress_item_id
              ? progressRateMap[t.linked_progress_item_id] || null
              : null,
          })
        );
      })()
    );
  }

  await Promise.all(promises);
  return batchResult;
}

/**
 * 確定保存する payload を組み立てる。
 *
 * 取得は runBatchForSchool をそのまま使う。ライブ表示と同じ関数で集めることで、
 * 「保存した中身と画面に出ていた中身が違う」というズレを構造的に起こさない。
 * includeHidden=true にするのは、非表示列も後から見返せるようにするため。
 */
export async function buildSnapshotPayload(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  season: string,
  year: number
) {
  const batch = await runBatchForSchool(supabaseAdmin, schoolId, season, year, true, [
    'students',
    'progress_items',
    'student_progress',
    'period',
    'auto_values',
  ]);

  const students = ((batch.students as Record<string, unknown>[]) || []).map(pickSnapshotStudent);
  const items = (batch.progress_items as Record<string, unknown>[]) || [];
  const progress = (batch.student_progress as Record<string, unknown>[]) || [];

  // 進捗セルは対象生徒の分だけ残す。生徒側は期間中在籍で絞っているのに
  // セルだけ全員分残ると、payload が無駄に太るうえ突き合わせが狂う。
  const studentIds = new Set(students.map((s) => s.id as string));
  const scopedProgress = progress.filter((p) => studentIds.has(p.student_id as string));

  // autoValues も同様に対象生徒の分だけに絞る。
  const autoValuesAll = (batch.auto_values as Record<string, unknown>) || {};
  const autoValues: Record<string, unknown> = {};
  // tsconfig に target 指定が無く ES5 扱いのため Set を直接 for-of できない（TS2802）
  for (const sid of Array.from(studentIds)) {
    if (autoValuesAll[sid] !== undefined) autoValues[sid] = autoValuesAll[sid];
  }

  return {
    payload: {
      version: SNAPSHOT_PAYLOAD_VERSION,
      students,
      items,
      progress: scopedProgress,
      autoValues,
      period: (batch.period as Record<string, unknown> | null) ?? null,
    },
    studentCount: students.length,
  };
}
