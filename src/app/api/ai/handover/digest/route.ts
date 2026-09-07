import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { hasRoleLevel } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { callClaudeJson, isClaudeConfigured, CLAUDE_MODELS, ClaudeError } from '@/lib/ai/claude';
import {
  digestSystemPrompt,
  digestUserText,
  parseDigestResult,
  MAX_ENTRIES,
  type HandoverDigest,
  type HandoverEntry,
} from '@/lib/ai/handoverDigest';
import { STUDENT_DIGEST_FEATURE_KEY } from '@/lib/ai/features';

export const dynamic = 'force-dynamic';

/**
 * 「これまでの引継ぎをまとめる」（進行表の「前回の引継ぎ」カードから呼ぶ）。
 *
 * ★講師も叩ける。いちばん読みたいのは、次にその生徒を教える講師だから。
 *   ここで教室長以上に閉じると、20回ぶんを通して読める人が誰もいないという
 *   元の問題がそのまま残る。
 *
 * ★送るのは引継ぎだけ。成績・出欠・保護者とのやりとりは含めない（栓は
 *   student_digest で共通だが、この口から出るのは引継ぎ本文と講師名と日付だけ）。
 *
 * ★教室ごとの栓を通る（student_digest・行が無ければOFF）。
 *
 * 正典: docs/ai-features-integration-plan.md
 */

interface DigestResponse {
  /** 作れなかったときは null。画面はパネルを開かない */
  digest: HandoverDigest | null;
  /** 材料にした回数。画面の「経緯（直近N回）」に出す */
  count: number;
  /** AIを呼べなかった。故障側 */
  degraded: boolean;
  /** この教室ではAIに送らない設定。故障ではなく意図した停止 */
  disabled: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  // ★講師以上。保護者は進行表そのものを見ないので、ここで落とす
  if (!hasRoleLevel(auth.role, 'teacher')) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: { schoolId?: unknown; studentTextbookId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const schoolId = typeof body.schoolId === 'string' ? body.schoolId : '';
  if (!UUID_RE.test(schoolId)) {
    return NextResponse.json({ error: '教室IDが不正です' }, { status: 400 });
  }
  if (!auth.schoolIds.includes(schoolId)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const studentTextbookId =
    typeof body.studentTextbookId === 'string' ? body.studentTextbookId : '';
  if (!UUID_RE.test(studentTextbookId)) {
    return NextResponse.json({ error: 'テキストの指定が不正です' }, { status: 400 });
  }

  const empty: DigestResponse = { digest: null, count: 0, degraded: false, disabled: false };

  const supabase = getPortalServiceClient();

  /**
   * ★このテキストが本当にその教室の生徒のものかを確かめる。
   *   student_textbooks にも school_id はあるが、正典は生徒の所属校のほう
   *   （所持教材の school_id はトリガーで追随させている派生値）。
   *   ここを省くと、自分の教室のIDを添えて他教室の studentTextbookId を投げるだけで
   *   引継ぎが読めてしまう。
   */
  const { data: tb } = await supabase
    .from('student_textbooks')
    .select('id, student:students!inner(school_id)')
    .eq('id', studentTextbookId)
    .maybeSingle();

  const owner = tb?.student as { school_id?: string } | { school_id?: string }[] | null | undefined;
  const ownerSchoolId = Array.isArray(owner) ? owner[0]?.school_id : owner?.school_id;
  if (!tb || ownerSchoolId !== schoolId) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  // ★この教室で「生徒のまとめ」を使ってよいか（行が無ければOFF）
  const { data: setting } = await supabase
    .from('school_ai_settings')
    .select('enabled')
    .eq('school_id', schoolId)
    .eq('feature_key', STUDENT_DIGEST_FEATURE_KEY)
    .maybeSingle();

  if (!setting?.enabled) {
    return NextResponse.json({ ...empty, disabled: true } satisfies DigestResponse);
  }

  /**
   * 材料を集める。
   * ★新しい順に取ってから古い順に並べ直す。古い順のまま .limit(20) を付けると
   *   いちばん古い20回が来てしまい、直近が1回も入らない。
   * ★.limit() は必ず付ける（未ページングの select は1000行で黙って切られる）。
   */
  const { data: rows } = await supabase
    .from('progress_sessions')
    .select('session_date, teacher_name, handover, homework_not_done, tardy')
    .eq('student_textbook_id', studentTextbookId)
    .not('handover', 'is', null)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(MAX_ENTRIES);

  const entries: HandoverEntry[] = (rows ?? [])
    // 空文字は NOT NULL をすり抜けるので、ここで落とす
    .filter((r) => typeof r.handover === 'string' && r.handover.trim().length > 0)
    .map((r) => ({
      date: r.session_date,
      teacher: r.teacher_name ?? '',
      text: (r.handover ?? '').trim(),
      homeworkNotDone: r.homework_not_done === true,
      tardy: r.tardy === true,
    }))
    .reverse(); // 古い順に戻す

  // 材料が無いのは故障ではない。degraded を立てず、件数0で返す
  if (entries.length === 0) {
    return NextResponse.json(empty satisfies DigestResponse);
  }

  if (!isClaudeConfigured()) {
    return NextResponse.json({ ...empty, degraded: true } satisfies DigestResponse);
  }

  try {
    const raw = await callClaudeJson<unknown>({
      // 20回ぶんを読み分けて時系列を保つ仕事なので smart
      model: CLAUDE_MODELS.smart,
      // 畳み方の決まりは毎回同じなのでキャッシュに載せる
      system: [{ text: digestSystemPrompt(), cache: true }],
      userText: digestUserText(entries),
      maxTokens: 1200,
    });

    const digest = parseDigestResult(
      raw,
      entries.map((e) => e.date)
    );
    if (digest.timeline.length === 0) {
      // 読めなかった。★中途半端に出さない
      return NextResponse.json({ ...empty, degraded: true } satisfies DigestResponse);
    }

    /**
     * 講師名を付け直す。★AIの出力からは採らない（名前は書かせていないし、書いてきても信じない）。
     * 渡した回のうち、同じ日付のものを渡した順に1つずつ当てる。
     * 苗字だけにするのは画面側（講師ロールのときだけ縮める）。
     */
    const byDate = new Map<string, string[]>();
    for (const e of entries) {
      const list = byDate.get(e.date) ?? [];
      list.push(e.teacher);
      byDate.set(e.date, list);
    }
    const timeline = digest.timeline.map((t) => ({
      ...t,
      teacher: byDate.get(t.date)?.shift() ?? '',
    }));

    return NextResponse.json({
      digest: { ...digest, timeline },
      count: entries.length,
      degraded: false,
      disabled: false,
    } satisfies DigestResponse);
  } catch (e) {
    const reason = e instanceof ClaudeError ? e.reason : 'unavailable';
    console.error('[ai/handover/digest] failed', reason, e);
    return NextResponse.json({ ...empty, degraded: true } satisfies DigestResponse);
  }
}
