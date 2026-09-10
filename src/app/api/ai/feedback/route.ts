import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { hasRoleLevel, isSystemAdmin } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { isAiFeatureKey } from '@/lib/ai/features';
import {
  isFeedbackTargetKind,
  isFeedbackVerdict,
  isVerdictForFeature,
  MAX_FEEDBACK_BATCH,
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
 * ★POSTは自分の教室のぶんだけ。ロールは講師以上（＝ログインできるスタッフ）にしてある。
 *   もとは教室長以上だったが、進行表の「引継ぎのまとめ」は講師がいちばん使う機能で、
 *   そこに置いた「合っていた／ずれていた」を講師が押しても記録されない状態になっていた。
 *   答えを捨てるくらいなら、自教室の行を1行足せるほうがよい（教室の越境は下で弾く）。
 *   GETはシステム管理者だけ。GETは全教室ぶんを返すので教室の境界を越える。
 *   改善のために見る画面であって、教室の運用で使うものではない。
 *
 * ★POSTは1件でも配列でも受ける（{ items: [...] }）。
 *   テーマふくらませは1回の反映で数百件ぶんの答えが出るので、
 *   1件ずつのリクエストにすると反映そのものより記録が重くなる。
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

/** insert する1行。★検証を通ったものだけがこの形になる */
interface FeedbackInsert {
  school_id: string;
  feature: string;
  target_kind: string;
  target_id: string | null;
  ai_output: Record<string, unknown>;
  verdict: string;
  note: string | null;
  created_by: string;
}

/**
 * 1件ぶんを検証して insert の形にする。読めなければ null。
 *
 * ★まとめて送られた中の1件が読めなくても、全体を400にしない。
 *   読めたものだけ入れる。記録は「おまけ」であり、1件の形が違うだけで
 *   数百件ぶんの答えを丸ごと捨てるほうが損である。
 */
function toInsert(
  raw: unknown,
  auth: { userId: string; schoolIds: string[] }
): FeedbackInsert | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;

  const schoolId = typeof body.schoolId === 'string' ? body.schoolId : '';
  if (!UUID_RE.test(schoolId)) return null;
  // ★自教室のぶんだけ。他教室の記録を書き込ませない
  if (!auth.schoolIds.includes(schoolId)) return null;

  if (!isAiFeatureKey(body.feature)) return null;
  if (!isFeedbackTargetKind(body.targetKind)) return null;
  // ★verdict は「その機能で使う一覧」に載っているものだけ。
  //   一覧に無い組み合わせ（例: おまかせ下書きに「読み間違い」）を入れると、
  //   機能ごとの件数が意味を持たなくなる
  if (!isVerdictForFeature(body.feature, body.verdict)) return null;

  // 対象IDは任意。あるなら形だけ確かめる（対象が消えていてもそのまま記録する）
  let targetId: string | null = null;
  if (body.targetId != null) {
    if (typeof body.targetId !== 'string' || !UUID_RE.test(body.targetId)) return null;
    targetId = body.targetId;
  }

  const note =
    typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, MAX_NOTE) : null;

  // ★大きすぎる ai_output は捨てる（その1件を落とさない）。
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

  return {
    school_id: schoolId,
    feature: body.feature,
    target_kind: body.targetKind,
    target_id: targetId,
    ai_output: aiOutput,
    verdict: body.verdict as string,
    note,
    created_by: auth.userId,
  };
}

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  // ★講師以上（＝ログインするスタッフ）。保護者は入れない
  if (!hasRoleLevel(auth.role, 'teacher')) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  // ★1件でも配列でも同じ検証を通す。入口を2つに分けると、
  //   片方だけ緩んだまま気づかない（verdict の一覧のような肝心なところで起きる）
  const items: unknown[] =
    body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)
      ? ((body as { items: unknown[] }).items as unknown[]).slice(0, MAX_FEEDBACK_BATCH)
      : [body];

  const inserts = items
    .map((item) => toInsert(item, { userId: auth.userId, schoolIds: auth.schoolIds }))
    .filter((row): row is FeedbackInsert => row !== null);

  // ★1件も読めなかったときだけ400。読めたものがあれば、そこまでで入れる
  if (inserts.length === 0) {
    return NextResponse.json({ error: '記録できる内容がありませんでした' }, { status: 400 });
  }

  const supabase = getPortalServiceClient();
  const { error } = await supabase.from('ai_feedback').insert(inserts);

  if (error) {
    console.error('[ai/feedback] 記録に失敗', error.message);
    return NextResponse.json({ error: '記録できませんでした' }, { status: 500 });
  }

  // skipped は「形が違って捨てた件数」。画面は見ないが、切り分けのために返す
  return NextResponse.json({
    ok: true,
    saved: inserts.length,
    skipped: items.length - inserts.length,
  });
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
