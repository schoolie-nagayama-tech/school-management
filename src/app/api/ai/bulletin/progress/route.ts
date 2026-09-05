import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  breakdownByTeacher,
  computeTaskProgress,
  type StudentRow,
  type TaskProgress,
} from '@/lib/bulletin/progress';
import { canAutoWrite } from '@/lib/bulletin/applicationSync';
import {
  REPORT_CARD_SUBJECTS,
  TASK_KIND_LABELS,
  TASK_SCOPE_LABELS,
  needsTargetPeriod,
  type TaskKind,
  type TaskScope,
} from '@/lib/bulletin/taskCatalog';
import type { BulletinTaskView } from '@/lib/bulletin/apiTypes';

export const dynamic = 'force-dynamic';

/**
 * 掲示板タスクの進捗（教室長以上）。
 *
 * ★閲覧時にその場で数える。バッチは持たない。
 *   実データを見にいくだけなので、バッチで前もって数える必要が無い。
 *   バッチにすると「いつの数字か」が増えて、督促の根拠がまた曖昧になる。
 *
 * ★このAPIには副作用が2つある。読むだけではない:
 *   1. 初めて済と観測した生徒を bulletin_task_completions に記録する
 *      （申込状況にも進行表にも履歴が無いので、ここでしか「いつ済んだか」が残らない）
 *   2. application_item_id が設定されていれば、申込状況のチェックを自動で付ける
 *      （教室長が外したチェックには触らない。applicationSync.canAutoWrite を通す）
 *
 * 正典: docs/bulletin-ai-assist.html
 */

/** カードに出す名前の数。これを超えたぶんは「ほかN人」にまとめる */
const NAME_PREVIEW = 5;

/** 1教室の生徒数は100名台。上限に当てないよう明示する（PostgRESTの1000行上限対策） */
const STUDENT_SCAN_LIMIT = 2000;
const SCORE_SCAN_LIMIT = 5000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 内申が入っている科目を生徒ごとに集める。
 * ★どの回（name_code）を見るかは呼び出し側が渡す。換算内申は科目ではないので拾わない。
 */
async function loadReportCardSubjects(
  supabase: SupabaseClient,
  studentIds: string[],
  namePeriod: string
): Promise<Map<string, string[]>> {
  const byStudent = new Map<string, string[]>();
  if (studentIds.length === 0) return byStudent;

  const { data, error } = await supabase
    .from('assessments')
    .select('student_id, assessment_scores(subject, value)')
    .eq('category', 'report_card')
    .eq('name_code', namePeriod)
    .in('student_id', studentIds)
    .limit(SCORE_SCAN_LIMIT);

  if (error) {
    console.error('[ai/bulletin/progress] 内申の取得に失敗', error.message);
    return byStudent;
  }

  const core = new Set<string>(REPORT_CARD_SUBJECTS);
  for (const row of data ?? []) {
    const sid = row.student_id as string;
    const scores = (row.assessment_scores ?? []) as { subject: string; value: number | null }[];
    const got = byStudent.get(sid) ?? [];
    for (const s of scores) {
      // ★換算内申（conv_*）は科目ではない。数に入れると9科の判定が水増しされる
      if (s.value != null && core.has(s.subject) && !got.includes(s.subject)) got.push(s.subject);
    }
    byStudent.set(sid, got);
  }
  return byStudent;
}

/**
 * 指定の回のテストに、1科目でも点が入っている生徒を集める。
 *
 * ★どの回かは教室長が選んだもの（target_period）だけを見る。
 *   決め打ちや推測をすると、入っていない回を見て「全員済」と出してしまう。
 */
async function loadTestEntered(
  supabase: SupabaseClient,
  studentIds: string[],
  namePeriod: string
): Promise<Set<string>> {
  const entered = new Set<string>();
  if (studentIds.length === 0) return entered;

  const { data, error } = await supabase
    .from('assessments')
    .select('student_id, assessment_scores(value)')
    .eq('category', 'regular_test')
    .eq('name_code', namePeriod)
    .in('student_id', studentIds)
    .limit(SCORE_SCAN_LIMIT);

  if (error) {
    console.error('[ai/bulletin/progress] テスト結果の取得に失敗', error.message);
    return entered;
  }

  for (const row of data ?? []) {
    const scores = (row.assessment_scores ?? []) as { value: number | null }[];
    if (scores.some((s) => s.value != null)) entered.add(row.student_id as string);
  }
  return entered;
}

/**
 * 依頼が出てから進行表に記録がある生徒を集める。
 *
 * ★「依頼より後の記録」だけを数える。前からある記録を数えると、
 *   依頼が出た瞬間にほぼ全員が済になり、督促の役に立たない。
 */
async function loadProgressRecorded(
  supabase: SupabaseClient,
  studentIds: string[],
  since: string
): Promise<Set<string>> {
  const recorded = new Set<string>();
  if (studentIds.length === 0) return recorded;

  const { data, error } = await supabase
    .from('progress_sessions')
    .select('session_date, student_textbooks!inner(student_id)')
    .gte('session_date', since)
    .in('student_textbooks.student_id', studentIds)
    .limit(SCORE_SCAN_LIMIT);

  if (error) {
    console.error('[ai/bulletin/progress] 進行表の記録の取得に失敗', error.message);
    return recorded;
  }

  for (const row of data ?? []) {
    // ★PostgREST の結合は配列で返ることがあるので、両方の形を受ける
    const raw = row.student_textbooks as { student_id: string } | { student_id: string }[] | null;
    const link = Array.isArray(raw) ? (raw[0] ?? null) : raw;
    if (link?.student_id) recorded.add(link.student_id);
  }
  return recorded;
}

/**
 * 初めて済と観測した生徒を記録する。
 * ★2回目以降は unique index が弾くので、観測時刻は最初の1回だけが残る。
 */
async function recordCompletions(
  supabase: SupabaseClient,
  params: { taskId: string; schoolId: string; progress: TaskProgress }
): Promise<void> {
  const doneRows = params.progress.students.filter((s) => s.state === 'done');
  if (doneRows.length === 0) return;

  const { error } = await supabase.from('bulletin_task_completions').upsert(
    doneRows.map((s) => ({
      task_id: params.taskId,
      school_id: params.schoolId,
      student_id: s.studentId,
      teacher_id: s.teacherId,
    })),
    { onConflict: 'task_id,student_id', ignoreDuplicates: true }
  );

  if (error) console.error('[ai/bulletin/progress] 完了履歴の記録に失敗', error.message);
}

/**
 * 実データが済の生徒に、申込状況のチェックを自動で付ける。
 *
 * ★人が触った行には触らない（canAutoWrite）。
 *   既存の行はすべて set_by='manual' なので、導入時点で入っている「対象外」を
 *   自動が「完了」で塗り替えることはない。
 */
async function syncApplicationChecks(
  supabase: SupabaseClient,
  params: { itemId: string; schoolId: string; progress: TaskProgress }
): Promise<number> {
  const doneIds = params.progress.students
    .filter((s) => s.state === 'done')
    .map((s) => s.studentId);
  if (doneIds.length === 0) return 0;

  const { data: existing, error } = await supabase
    .from('student_applications')
    .select('id, student_id, status, set_by')
    .eq('item_id', params.itemId)
    .in('student_id', doneIds);

  if (error) {
    console.error('[ai/bulletin/progress] 申込状況の取得に失敗', error.message);
    return 0;
  }

  const byStudent = new Map(
    (existing ?? []).map((r) => [
      r.student_id as string,
      { id: r.id as string, status: r.status as string | null, setBy: r.set_by as string | null },
    ])
  );

  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: string[] = [];

  for (const sid of doneIds) {
    const row = byStudent.get(sid);
    const state = {
      exists: Boolean(row),
      setBy: row?.setBy === 'auto' ? 'auto' : 'manual',
    } as const;
    if (!canAutoWrite(state)) continue;
    if (row?.status === 'completed') continue; // すでに付いている

    if (row) toUpdate.push(row.id);
    else
      toInsert.push({
        school_id: params.schoolId,
        student_id: sid,
        item_id: params.itemId,
        status: 'completed',
        set_by: 'auto',
      });
  }

  let changed = 0;

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from('student_applications').insert(toInsert);
    if (insertError)
      console.error('[ai/bulletin/progress] 自動チェックに失敗', insertError.message);
    else changed += toInsert.length;
  }

  if (toUpdate.length > 0) {
    const { error: updateError } = await supabase
      .from('student_applications')
      .update({ status: 'completed', set_by: 'auto' })
      .in('id', toUpdate);
    if (updateError)
      console.error('[ai/bulletin/progress] 自動チェックに失敗', updateError.message);
    else changed += toUpdate.length;
  }

  return changed;
}

/**
 * タスクを生んだ掲示板投稿を、タスクごとにまとめて引く。
 *
 * ★どの投稿から来たかを出さないと、教室長は「×で消してよいか」を判断できない。
 *   同じ依頼が再掲されると2件以上になるので、新しい順に並べて全部返す
 *   （何回目の依頼かが分かると、督促の重複にも気づける）。
 */
async function loadSources(
  supabase: SupabaseClient,
  taskIds: string[]
): Promise<Map<string, { title: string; postedAt: string | null }[]>> {
  const byTask = new Map<string, { title: string; postedAt: string | null }[]>();
  if (taskIds.length === 0) return byTask;

  const { data, error } = await supabase
    .from('bulletin_task_posts')
    .select('task_id, bulletin_posts(title, created_at)')
    .in('task_id', taskIds);

  if (error) {
    console.error('[ai/bulletin/progress] 投稿元の取得に失敗', error.message);
    return byTask;
  }

  for (const row of data ?? []) {
    // ★PostgREST の結合は配列で返ることがあるので、両方の形を受ける
    const raw = row.bulletin_posts as
      | { title: string; created_at: string }
      | { title: string; created_at: string }[]
      | null;
    const post = Array.isArray(raw) ? (raw[0] ?? null) : raw;
    if (!post) continue;
    const list = byTask.get(row.task_id as string) ?? [];
    list.push({ title: post.title, postedAt: post.created_at ?? null });
    byTask.set(row.task_id as string, list);
  }

  // 新しい順。画面は先頭を「この依頼の出どころ」として使う。
  // ★tsconfig に target が無く ES5 扱いなので、Map のイテレータは Array.from で回す
  for (const list of Array.from(byTask.values())) {
    list.sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''));
  }
  return byTask;
}

export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const schoolId = request.nextUrl.searchParams.get('school_id') ?? '';
  if (!UUID_RE.test(schoolId)) {
    return NextResponse.json({ error: '教室IDが不正です' }, { status: 400 });
  }
  if (!auth.schoolIds.includes(schoolId)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const supabase = getPortalServiceClient();

  const { data: taskRows, error: taskError } = await supabase
    .from('bulletin_tasks')
    .select(
      'id, kind, scope, target_grades, target_student_ids, due_type, due_date, application_item_id, target_period, created_at'
    )
    .eq('school_id', schoolId)
    .is('closed_at', null)
    .eq('tracked', true)
    .order('created_at', { ascending: false });

  if (taskError) {
    console.error('[ai/bulletin/progress] タスクの取得に失敗', taskError.message);
    return NextResponse.json({ tasks: [], measuredAt: new Date().toISOString() });
  }
  if (!taskRows || taskRows.length === 0) {
    return NextResponse.json({ tasks: [], measuredAt: new Date().toISOString() });
  }

  // 在籍生徒。研修用テスト生徒は数えない
  const { data: studentRows } = await supabase
    .from('students')
    .select('id, grade, last_name, first_name')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .neq('is_test', true)
    .limit(STUDENT_SCAN_LIMIT);

  const students = (studentRows ?? []).map((s) => ({
    id: s.id as string,
    grade: (s.grade as number | null) ?? null,
  }));
  const studentIds = students.map((s) => s.id);

  // 残っている生徒の名前を出すための対応表
  const nameById = new Map<string, string>(
    (studentRows ?? []).map((s) => [
      s.id as string,
      `${(s.last_name as string) ?? ''} ${(s.first_name as string) ?? ''}`.trim(),
    ])
  );

  const sourcesByTask = await loadSources(
    supabase,
    taskRows.map((t) => t.id as string)
  );

  // 内申は種別が使うときだけ引く
  // ★材料は種別が要るときだけ引く。同じ回を何度も引かないよう、回ごとに覚えておく。
  //   内申も定期テストも「どの回か」でデータが変わるので、回をまたいで使い回せない。
  const reportCardCache = new Map<string, Map<string, string[]>>();
  const testCache = new Map<string, Set<string>>();
  let progressRecorded: Set<string> | null = null;

  const views: BulletinTaskView[] = [];

  for (const t of taskRows) {
    const kind = t.kind as TaskKind;
    const scope = t.scope as TaskScope;
    const itemId = (t.application_item_id as string | null) ?? null;

    // ★「対象外」はこのタスクが指す申込状況の列で人が付けたもの。列が未設定なら対象外は無い
    const notApplicable = new Set<string>();
    if (itemId) {
      const { data: naRows } = await supabase
        .from('student_applications')
        .select('student_id')
        .eq('item_id', itemId)
        .eq('status', 'not_applicable');
      for (const r of naRows ?? []) notApplicable.add(r.student_id as string);
    }

    const rows: StudentRow[] = students.map((s) => ({
      id: s.id,
      grade: s.grade,
      // 担当の解決は進捗ボードの内訳でだけ要る。次のPRで座席表→固定講師→進行表の順に入れる
      teacherId: null,
      markedNotApplicable: notApplicable.has(s.id),
    }));

    // この種別が要る材料だけを引く（回ごとにキャッシュ）
    const period = (t.target_period as string | null) ?? null;

    if (kind === 'report_card_entry' && period && !reportCardCache.has(period)) {
      reportCardCache.set(period, await loadReportCardSubjects(supabase, studentIds, period));
    }
    if (kind === 'test_result_entry' && period && !testCache.has(period)) {
      testCache.set(period, await loadTestEntered(supabase, studentIds, period));
    }
    if (kind === 'progress_entry' && progressRecorded === null) {
      // 「依頼が出てから」の記録だけを数える
      progressRecorded = await loadProgressRecorded(
        supabase,
        studentIds,
        String(t.created_at).slice(0, 10)
      );
    }

    const progress = computeTaskProgress({
      kind,
      scope,
      targetGrades: (t.target_grades as number[]) ?? [],
      targetStudentIds: (t.target_student_ids as string[]) ?? [],
      students: rows,
      hasTargetPeriod: Boolean(period),
      inputs: {
        subjectsByStudent: period ? reportCardCache.get(period) : undefined,
        testEnteredStudentIds: period ? testCache.get(period) : undefined,
        progressRecordedStudentIds: progressRecorded ?? undefined,
      },
    });

    let autoChecked = 0;
    if (!progress.unsupported) {
      await recordCompletions(supabase, { taskId: t.id as string, schoolId, progress });
      if (itemId) {
        autoChecked = await syncApplicationChecks(supabase, { itemId, schoolId, progress });
      }
    }

    views.push({
      taskId: t.id as string,
      kind,
      kindLabel: TASK_KIND_LABELS[kind] ?? kind,
      scope,
      scopeLabel: TASK_SCOPE_LABELS[scope] ?? scope,
      dueType: t.due_type as string,
      dueDate: (t.due_date as string | null) ?? null,
      unsupported: progress.unsupported,
      total: progress.total,
      done: progress.done,
      notYet: progress.notYet,
      excluded: progress.excluded,
      teachers: breakdownByTeacher(progress),
      applicationItemId: itemId,
      autoChecked,
      notYetNames: progress.students
        .filter((s) => s.state === 'not_yet')
        .slice(0, NAME_PREVIEW)
        .map((s) => nameById.get(s.studentId) ?? '')
        .filter(Boolean),
      sources: sourcesByTask.get(t.id as string) ?? [],
      createdAt: t.created_at as string,
      targetPeriod: period,
      needsPeriod: needsTargetPeriod(kind),
    });
  }

  return NextResponse.json({ tasks: views, measuredAt: new Date().toISOString() });
}
