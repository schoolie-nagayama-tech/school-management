import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { callClaudeJson, isClaudeConfigured, CLAUDE_MODELS, ClaudeError } from '@/lib/ai/claude';
import { extractSystemPrompt, extractUserText } from '@/lib/bulletin/extractPrompt';
import {
  findReminderTarget,
  parseExtractedTasks,
  shouldUpdateDueDate,
  type ExtractedTask,
  type OpenTask,
} from '@/lib/bulletin/extractResult';
import {
  TASK_KIND_LABELS,
  TASK_SCOPE_LABELS,
  type TaskKind,
  type TaskScope,
} from '@/lib/bulletin/taskCatalog';

import { BULLETIN_AI_FEATURE_KEY } from '@/lib/bulletin/schoolSetting';

export const dynamic = 'force-dynamic';

/**
 * 掲示板の投稿からタスクを抽出する（教室長以上）。
 *
 * ★投稿UIは変えない。教室長はこれまで通り自由文で書き、投稿した直後にこれを呼ぶ。
 *   結果はその場で見せ、違えば「追跡しない」に落とせる。★承認は挟まない
 *   （承認待ちにすると「押し忘れたら何も起きない」で、いまの督促と同じ問題が形を変えて残る）。
 *
 * ★同じ依頼の再掲は既存タスクに束ねる。投稿ごとに別タスクを作ると、
 *   進捗が投稿のたびにリセットされてしまう（通知表回収は清瀬校だけで4回投稿されていた）。
 *
 * 正典: docs/bulletin-ai-assist.html
 */

export interface ExtractedTaskView {
  taskId: string;
  kind: TaskKind;
  kindLabel: string;
  scope: TaskScope;
  scopeLabel: string;
  targetGrades: number[];
  dueType: string;
  dueDate: string | null;
  reason: string;
  /** 既存タスクへの再掲としてまとめたか（新規作成ではない） */
  isReminder: boolean;
}

interface ExtractResponse {
  tasks: ExtractedTaskView[];
  /** AIを呼べなかった。画面は黙って何も出さない */
  degraded: boolean;
  /**
   * この教室では読み取りを許していない（school_ai_settings）。
   * ★degraded と分けるのは、こちらは故障ではなく意図した停止だから。
   *   同じ扱いにすると、止めているのか壊れているのかがログから判別できなくなる。
   */
  disabled: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 本文が長すぎるとプロンプトが膨らむので切る。掲示板の投稿は実データで最大2千字ほど */
const MAX_CONTENT = 4000;

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: { postId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const postId = typeof body.postId === 'string' ? body.postId : '';
  if (!UUID_RE.test(postId)) {
    return NextResponse.json({ error: '投稿IDが不正です' }, { status: 400 });
  }

  const supabase = getPortalServiceClient();

  // 投稿を読む。★教室スコープの確認も兼ねる（他教室の投稿は抽出させない）
  const { data: post, error: postError } = await supabase
    .from('bulletin_posts')
    .select('id, school_id, title, content')
    .eq('id', postId)
    .maybeSingle();

  if (postError || !post) {
    return NextResponse.json({ error: '投稿が見つかりません' }, { status: 404 });
  }
  const schoolId = post.school_id as string;
  if (!auth.schoolIds.includes(schoolId)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const empty: ExtractResponse = { tasks: [], degraded: false, disabled: false };

  // ★この教室で読み取りを許していなければ、AIを呼ぶ前にここで止める。
  //   読み取りは投稿の件名と本文をそのまま外部（Anthropic）に送る。
  //   プライバシーポリシーがリーガルチェック中で Anthropic を追記できていないので、
  //   出してよいと決めた教室以外では送信そのものを起こさない。
  //   ★行が無ければOFF（設定を作り忘れた教室が黙って送るのを防ぐ）。
  const { data: setting } = await supabase
    .from('school_ai_settings')
    .select('enabled')
    .eq('school_id', schoolId)
    .eq('feature_key', BULLETIN_AI_FEATURE_KEY)
    .maybeSingle();

  if (!setting?.enabled) {
    return NextResponse.json({ ...empty, disabled: true } satisfies ExtractResponse);
  }

  if (!isClaudeConfigured()) {
    return NextResponse.json({ ...empty, degraded: true } satisfies ExtractResponse);
  }

  let extracted: ExtractedTask[];
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await callClaudeJson<unknown>({
      model: CLAUDE_MODELS.fast,
      // 一覧は毎回同じなのでキャッシュに載せる
      system: [{ text: extractSystemPrompt(), cache: true }],
      userText: extractUserText({
        title: String(post.title ?? ''),
        content: String(post.content ?? '').slice(0, MAX_CONTENT),
        today,
      }),
      maxTokens: 700,
    });
    extracted = parseExtractedTasks(result);
  } catch (e) {
    const reason = e instanceof ClaudeError ? e.reason : 'unavailable';
    console.error('[ai/bulletin/extract] failed', reason, e);
    // ★抽出できなくても投稿は成立している。画面は黙って何も出さない
    return NextResponse.json({ ...empty, degraded: true } satisfies ExtractResponse);
  }

  if (extracted.length === 0) {
    return NextResponse.json(empty satisfies ExtractResponse);
  }

  // 再掲の突き合わせに使う、この教室の追跡中タスク
  const { data: openRows } = await supabase
    .from('bulletin_tasks')
    .select('id, kind, scope, due_date')
    .eq('school_id', schoolId)
    .is('closed_at', null)
    .eq('tracked', true);

  const openTasks: OpenTask[] = (openRows ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as TaskKind,
    scope: r.scope as TaskScope,
    dueDate: (r.due_date as string | null) ?? null,
  }));

  const views: ExtractedTaskView[] = [];

  for (const task of extracted) {
    const target = findReminderTarget(task, openTasks);

    let taskId: string;
    if (target) {
      // ★再掲。新しいタスクを作らず、既存に投稿を足す
      taskId = target.id;
      if (shouldUpdateDueDate(task, target)) {
        await supabase
          .from('bulletin_tasks')
          .update({ due_date: task.dueDate, updated_at: new Date().toISOString() })
          .eq('id', taskId);
      }
    } else {
      const { data: created, error: createError } = await supabase
        .from('bulletin_tasks')
        .insert({
          school_id: schoolId,
          kind: task.kind,
          scope: task.scope,
          target_grades: task.targetGrades,
          due_type: task.dueType,
          due_date: task.dueDate,
        })
        .select('id')
        .single();

      if (createError || !created) {
        console.error('[ai/bulletin/extract] タスクの作成に失敗', createError?.message);
        continue;
      }
      taskId = created.id as string;
      // 次のループで同じ種別×対象が来ても二重に作らない
      openTasks.push({ id: taskId, kind: task.kind, scope: task.scope, dueDate: task.dueDate });
    }

    // 投稿を紐づける（同じ投稿を二度足さない）
    const { error: linkError } = await supabase
      .from('bulletin_task_posts')
      .upsert({ task_id: taskId, post_id: postId }, { onConflict: 'task_id,post_id' });
    if (linkError) {
      console.error('[ai/bulletin/extract] 投稿の紐づけに失敗', linkError.message);
    }

    views.push({
      taskId,
      kind: task.kind,
      kindLabel: TASK_KIND_LABELS[task.kind],
      scope: task.scope,
      scopeLabel: TASK_SCOPE_LABELS[task.scope],
      targetGrades: task.targetGrades,
      dueType: task.dueType,
      dueDate: task.dueDate,
      reason: task.reason,
      isReminder: Boolean(target),
    });
  }

  return NextResponse.json({
    tasks: views,
    degraded: false,
    disabled: false,
  } satisfies ExtractResponse);
}
