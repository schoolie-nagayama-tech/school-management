import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove, isSystemAdmin } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { isAiFeatureKey } from '@/lib/ai/features';
import {
  isFeedbackTargetKind,
  isFeedbackVerdict,
  type AiFeedbackListResponse,
  type AiFeedbackRow,
} from '@/lib/ai/feedback';

export const dynamic = 'force-dynamic';

/**
 * AIの読み取りの答え合わせを記録する／読む。
 *
 * 正典: docs/bulletin-ai-assist.html
 *
 * ★入口はこの1本だけ。機能ごとにAPIを生やすと、
 *   「AIはどこで間違えているか」を横断で数えられなくなる。
 *   どのAI機能のフィードバックも POST /api/ai/feedback に来る。
 *
 * ★POSTは教室長以上（画面に出る操作の主は教室長）。GETはシステム管理者だけ。
 *   GETは全教室ぶんを返すので、教室の境界を越える。改善のために見る画面であって、
 *   教室の運用で使うものではない。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 一言メモの上限。長文を入れる欄ではない */
const MAX_NOTE = 200;

/** ai_output の上限（おおよそ4KB）。★超えたら捨てて空で入れる。
 *  記録が肥大化しても読み間違いの追跡には役立たない一方、行が重くなると一覧が開かなくなる。
 *  ★エラーにはしない。FBの記録が本体の操作を止めてはいけない。 */
const MAX_AI_OUTPUT_BYTES = 4096;

/** 一覧の既定件数と上限。★.limit() を必ず付ける（PostgRESTは無指定だと1000行で黙って切る） */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: {
    schoolId?: unknown;
    feature?: unknown;
    targetKind?: unknown;
    targetId?: unknown;
    aiOutput?: unknown;
    verdict?: unknown;
    note?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const schoolId = typeof body.schoolId === 'string' ? body.schoolId : '';
  if (!UUID_RE.test(schoolId)) {
    return NextResponse.json({ error: '教室IDが不正です' }, { status: 400 });
  }
  // ★自教室のぶんだけ。他教室の記録を書き込ませない
  if (!auth.schoolIds.includes(schoolId)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  if (!isAiFeatureKey(body.feature)) {
    return NextResponse.json({ error: '機能の指定が不正です' }, { status: 400 });
  }
  if (!isFeedbackTargetKind(body.targetKind)) {
    return NextResponse.json({ error: '対象の指定が不正です' }, { status: 400 });
  }
  // ★verdict は一覧のどれかに限る。自由記述を通すと数えられなくなる
  if (!isFeedbackVerdict(body.verdict)) {
    return NextResponse.json({ error: '判断の指定が不正です' }, { status: 400 });
  }

  // 対象IDは任意。あるなら形だけ確かめる（対象が消えていてもそのまま記録する）
  let targetId: string | null = null;
  if (body.targetId != null) {
    if (typeof body.targetId !== 'string' || !UUID_RE.test(body.targetId)) {
      return NextResponse.json({ error: '対象IDが不正です' }, { status: 400 });
    }
    targetId = body.targetId;
  }

  const note =
    typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, MAX_NOTE) : null;

  // ★大きすぎる ai_output は捨てる（エラーにはしない）。
  //   記録が入らないより、AIの出力だけ落ちて判断が残るほうが良い。
  let aiOutput: Record<string, unknown> = {};
  if (body.aiOutput && typeof body.aiOutput === 'object' && !Array.isArray(body.aiOutput)) {
    const candidate = body.aiOutput as Record<string, unknown>;
    try {
      const serialized = JSON.stringify(candidate);
      if (serialized.length <= MAX_AI_OUTPUT_BYTES) {
        aiOutput = candidate;
      } else {
        console.warn('[ai/feedback] ai_output が大きすぎるので捨てました', serialized.length);
      }
    } catch {
      // 循環参照などで文字列化できないものは捨てる
    }
  }

  const supabase = getPortalServiceClient();
  const { error } = await supabase.from('ai_feedback').insert({
    school_id: schoolId,
    feature: body.feature,
    target_kind: body.targetKind,
    target_id: targetId,
    ai_output: aiOutput,
    verdict: body.verdict,
    note,
    created_by: auth.userId,
  });

  if (error) {
    console.error('[ai/feedback] 記録に失敗', error.message);
    return NextResponse.json({ error: '記録できませんでした' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * 答え合わせの一覧（★システム管理者のみ）。
 * 全教室ぶんを新しい順で返す。読み間違いが何件あるかを数えるための画面が使う。
 */
export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isSystemAdmin(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const feature = params.get('feature') ?? '';
  const verdict = params.get('verdict') ?? '';

  const rawLimit = Number(params.get('limit'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const supabase = getPortalServiceClient();

  // ★絞り込みは order/limit より先に積む（.limit() の戻り値には .eq() が生えていない）
  let query = supabase
    .from('ai_feedback')
    .select(
      'id, created_at, school_id, feature, target_kind, target_id, ai_output, verdict, note, schools(name), user_profiles(display_name)'
    );

  // 値が一覧に無ければ絞り込みそのものを無視する（不正な値で空を返して混乱させない）
  if (isAiFeatureKey(feature)) query = query.eq('feature', feature);
  if (isFeedbackVerdict(verdict)) query = query.eq('verdict', verdict);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    // ★必ず付ける。無指定だとPostgRESTが1000行で黙って切る
    .limit(limit);

  if (error) {
    console.error('[ai/feedback] 一覧の取得に失敗', error.message);
    return NextResponse.json({ error: '取得できませんでした' }, { status: 500 });
  }

  // ★PostgRESTの結合は1件でも配列で返ることがある。どちらでも読めるようにする
  const pickName = (joined: unknown, key: string): string => {
    const row = Array.isArray(joined) ? joined[0] : joined;
    if (!row || typeof row !== 'object') return '';
    const value = (row as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : '';
  };

  const rows: AiFeedbackRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    schoolId: r.school_id as string,
    schoolName: pickName(r.schools, 'name'),
    feature: r.feature as string,
    targetKind: r.target_kind as string,
    targetId: (r.target_id as string | null) ?? null,
    aiOutput: (r.ai_output as Record<string, unknown> | null) ?? {},
    verdict: r.verdict as string,
    note: (r.note as string | null) ?? null,
    createdByName: pickName(r.user_profiles, 'display_name'),
  }));

  return NextResponse.json({ rows } satisfies AiFeedbackListResponse);
}
