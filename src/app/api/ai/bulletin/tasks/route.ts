import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';

export const dynamic = 'force-dynamic';

/**
 * 抽出したタスクを「追跡しない」に落とす／戻す（教室長以上）。
 *
 * ★承認は挟まない代わりに、これが要る。抽出は自動で走って既定は追跡するので、
 *   違ったときにその場で外せる逃げ道が無いと、教室長は抽出そのものを信用できない。
 *
 * ★消さずに tracked=false にする。同じ依頼が再掲されたときに、
 *   「この教室ではこれを追跡しないと決めた」ことを覚えておきたいため
 *   （消すと再掲のたびに新しいタスクとして復活する）。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: {
    taskId?: unknown;
    tracked?: unknown;
    applicationItemId?: unknown;
    targetPeriod?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const taskId = typeof body.taskId === 'string' ? body.taskId : '';
  if (!UUID_RE.test(taskId)) {
    return NextResponse.json({ error: 'タスクIDが不正です' }, { status: 400 });
  }

  // 送られてきた項目だけを変える。★3つとも省略なら何もしない（黙って空更新をしない）
  const patch: Record<string, unknown> = {};

  if (body.tracked !== undefined) {
    if (typeof body.tracked !== 'boolean') {
      return NextResponse.json({ error: '指定が不正です' }, { status: 400 });
    }
    patch.tracked = body.tracked;
  }

  // 申込状況の列。★列名は教室ごとにバラバラなのでAIには選ばせない。人が1回選ぶ
  if (body.applicationItemId !== undefined) {
    if (body.applicationItemId === null) {
      patch.application_item_id = null;
    } else if (typeof body.applicationItemId === 'string' && UUID_RE.test(body.applicationItemId)) {
      patch.application_item_id = body.applicationItemId;
    } else {
      return NextResponse.json({ error: '列の指定が不正です' }, { status: 400 });
    }
  }

  // どの回か（assessments.name_code）。★これもAIに推測させない
  if (body.targetPeriod !== undefined) {
    if (body.targetPeriod === null) {
      patch.target_period = null;
    } else if (
      typeof body.targetPeriod === 'string' &&
      /^[a-z0-9_]{1,32}$/.test(body.targetPeriod)
    ) {
      patch.target_period = body.targetPeriod;
    } else {
      return NextResponse.json({ error: '回の指定が不正です' }, { status: 400 });
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '変更する内容がありません' }, { status: 400 });
  }

  const supabase = getPortalServiceClient();

  // ★自教室のタスクだけ。他教室のタスクを外させない
  const { data: task } = await supabase
    .from('bulletin_tasks')
    .select('id, school_id')
    .eq('id', taskId)
    .maybeSingle();

  if (!task) {
    return NextResponse.json({ error: 'タスクが見つかりません' }, { status: 404 });
  }
  if (!auth.schoolIds.includes(task.school_id as string)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const { error } = await supabase
    .from('bulletin_tasks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', taskId);

  if (error) {
    console.error('[ai/bulletin/tasks] 更新に失敗', error.message);
    return NextResponse.json({ error: '更新できませんでした' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
