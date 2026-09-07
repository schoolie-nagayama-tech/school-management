import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { callClaudeJson, isClaudeConfigured, CLAUDE_MODELS, ClaudeError } from '@/lib/ai/claude';
import {
  briefSectionLabel,
  briefSystemPrompt,
  briefUserText,
  parseBriefResult,
  sanitizeBriefSections,
  sortBriefSections,
  MAX_CURRENT_LINE_LENGTH,
  type BriefSectionInput,
  type BriefSectionKey,
  type BriefSign,
  type BriefTalk,
} from '@/lib/ai/interviewBrief';
import { STUDENT_DIGEST_FEATURE_KEY } from '@/lib/ai/features';

export const dynamic = 'force-dynamic';

/**
 * 面談の「報告事項」（面談ワークスペースの左カラムのカードから呼ぶ）。
 *
 * ★教室長以上。面談そのものが教室長の仕事で、講師は /interview を開かない。
 *   （同じ栓を使う進行表の「引継ぎをまとめる」は講師も叩ける。あちらは授業の直前に
 *   次に教える講師が読むものなので、権限をそろえる必要はない）
 *
 * ★現状の行はクライアントが送る。面談画面は成績・進行表・宿題と遅刻・面談記録・講習申込を
 *   すでに読んでいるので、サーバーで同じものを読み直すと、同じ数字を2か所で組むことになり、
 *   画面とカードで食い違ったときに原因を追えなくなる。
 *   サーバーが足すのは、面談画面が読んでいない2つ（授業の様子＝引継ぎ／保護者とのやりとり）だけ。
 *
 * ★教室ごとの栓を通る（student_digest・行が無ければOFF）。
 *
 * 正典: docs/interview-brief-ai-plan.md
 */

/** 画面に返す1セクション。current（システムの記録）と seen（AIが読んだもの）を分けて持つ */
interface BriefSectionPayload {
  key: BriefSectionKey;
  label: string;
  current: string[];
  seen: string;
  sign: BriefSign;
}

interface BriefResponse {
  sections: BriefSectionPayload[];
  thread: string;
  talk: BriefTalk[];
  /** AIを呼べなかった・読めなかった。故障側（現状の行は返しているので画面は成立する） */
  degraded: boolean;
  /** この教室ではAIに送らない設定。故障ではなく意図した停止 */
  disabled: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 「授業の様子」に載せる引継ぎの回数。1回45字として900字ぶん */
const LESSON_ENTRIES = 20;
/** 「保護者と」に載せるやりとりの件数 */
const PARENT_MESSAGES = 10;
/** 直近の連絡の本文をどこまで載せるか */
const PARENT_BODY_LENGTH = 80;

/**
 * タイムスタンプ（UTC）を日本時間の 'M/D' にする（現状の行は狭い枠に出すので年は落とす）。
 * ★UTCのまま先頭10字を切らない。夜のやりとりが前日にずれて「返信待ちが3日前」に見える。
 */
function shortDateJst(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  const jst = new Date(t + 9 * 60 * 60 * 1000);
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

/**
 * 「授業の様子」の現状の行を組む。
 *
 * ★進行表の「これまでの引継ぎをまとめる」（digestUserText）と同じ形に揃える。
 *   同じ材料を2つの機能で違う形に整えると、片方だけ直したときに気づけない。
 */
async function loadLessonLines(
  supabase: ReturnType<typeof getPortalServiceClient>,
  studentId: string
): Promise<string[]> {
  /**
   * ★新しい順に取ってから古い順に戻す。古い順のまま .limit(20) を付けると
   *   いちばん古い20回が来てしまい、直近が1回も入らない。
   * ★.limit() は必ず付ける（未ページングの select は1000行で黙って切られる）。
   */
  const { data, error } = await supabase
    .from('progress_sessions')
    .select(
      'session_date, teacher_name, handover, homework_not_done, tardy, student_textbooks!inner(student_id)'
    )
    .eq('student_textbooks.student_id', studentId)
    .not('handover', 'is', null)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(LESSON_ENTRIES);

  if (error) {
    console.error('[ai/interview/brief] 引継ぎの取得に失敗', error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as {
    session_date: string;
    teacher_name: string | null;
    handover: string | null;
    homework_not_done: boolean | null;
    tardy: boolean | null;
  }[];

  return (
    rows
      // 空文字は NOT NULL をすり抜けるので、ここで落とす
      .filter((r) => typeof r.handover === 'string' && r.handover.trim().length > 0)
      .map((r) => {
        const marks: string[] = [];
        if (r.homework_not_done === true) marks.push('（宿題未提出）');
        if (r.tardy === true) marks.push('（遅刻）');
        const body = (r.handover ?? '').replace(/\s+/g, ' ').trim();
        const teacher = (r.teacher_name ?? '').trim();
        const head = `${r.session_date.replace(/-/g, '/')}${teacher ? ` ${teacher}` : ''}`;
        return `${head}: ${body}${marks.join('')}`.slice(0, MAX_CURRENT_LINE_LENGTH);
      })
      .reverse()
  ); // 古い順に戻す
}

/**
 * 「保護者と」の現状の行を組む。スレッドが無ければ空配列（＝セクションごと出さない）。
 *
 * ★chat_* は portal ロール以外に SELECT ポリシーを作っていないので、service role で読む
 *   （教室の照合は呼び出し元でしてある）。
 */
async function loadParentLines(
  supabase: ReturnType<typeof getPortalServiceClient>,
  studentId: string
): Promise<string[]> {
  const { data: threads } = await supabase
    .from('chat_threads')
    .select('id')
    .eq('student_id', studentId)
    .limit(5);

  const threadIds = (threads ?? []).map((t) => (t as { id: string }).id);
  if (threadIds.length === 0) return [];

  // count は絞り込み全体の件数が返るので、直近10件だけ取りつつ「やりとり N件」を出せる
  const { data, count } = await supabase
    .from('chat_messages')
    .select('sender_kind, body, created_at', { count: 'exact' })
    .in('thread_id', threadIds)
    .order('created_at', { ascending: false })
    .limit(PARENT_MESSAGES);

  const messages = (data ?? []) as unknown as {
    sender_kind: string | null;
    body: string | null;
    created_at: string;
  }[];
  if (messages.length === 0) return [];

  const lines: string[] = [`やりとり ${count ?? messages.length}件`];

  const latest = messages[0];
  const body = (latest.body ?? '').replace(/\s+/g, ' ').trim();
  if (body) {
    /**
     * ★誰の発言かは sender_kind どおりに書く。テンプレートに「保護者」と決め打ちすると、
     *   教室が最後に送った連絡を保護者の言葉として読ませてしまう。
     */
    const who = latest.sender_kind === 'portal' ? '保護者' : '教室';
    lines.push(
      `直近 ${shortDateJst(latest.created_at)} ${who}: ${body.slice(0, PARENT_BODY_LENGTH)}`
    );
  }

  // 最後が保護者からなら、こちらが返していない
  if (latest.sender_kind === 'portal') lines.push('返信待ち');

  return lines.map((l) => l.slice(0, MAX_CURRENT_LINE_LENGTH));
}

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isManagerOrAbove(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  let body: { schoolId?: unknown; studentId?: unknown; sections?: unknown };
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

  const studentId = typeof body.studentId === 'string' ? body.studentId : '';
  if (!UUID_RE.test(studentId)) {
    return NextResponse.json({ error: '生徒の指定が不正です' }, { status: 400 });
  }

  const empty: BriefResponse = {
    sections: [],
    thread: '',
    talk: [],
    degraded: false,
    disabled: false,
  };

  const supabase = getPortalServiceClient();

  /**
   * ★その生徒が本当にこの教室かを確かめる。ここを省くと、自分の教室のIDを添えて
   *   他教室の studentId を投げるだけで、引継ぎと保護者とのやりとりが読めてしまう。
   */
  const { data: student } = await supabase
    .from('students')
    .select('id, school_id')
    .eq('id', studentId)
    .maybeSingle();
  if (!student || (student as { school_id?: string }).school_id !== schoolId) {
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
    return NextResponse.json({ ...empty, disabled: true } satisfies BriefResponse);
  }

  /**
   * クライアントの現状の行。★lessons と parent は受け取っても捨てる。
   * この2つはサーバーが読む決まりなので、クライアントの言い値を混ぜると
   * 「画面に無いはずの引継ぎ」を差し込める口になる。
   */
  const fromClient = sanitizeBriefSections(body.sections).filter(
    (s) => s.key !== 'lessons' && s.key !== 'parent'
  );

  const [lessonLines, parentLines] = await Promise.all([
    loadLessonLines(supabase, studentId),
    loadParentLines(supabase, studentId),
  ]);

  const added: BriefSectionInput[] = [];
  if (lessonLines.length > 0) added.push({ key: 'lessons', current: lessonLines });
  if (parentLines.length > 0) added.push({ key: 'parent', current: parentLines });

  /**
   * 並びは BRIEF_SECTIONS の固定順に戻す。
   * ★ここで sanitizeBriefSections に通し直さない。「授業の様子」は直近20回ぶんで、
   *   クライアント入力用の行数上限（12行）に掛けると直近の8回が黙って落ちる。
   */
  const sections = sortBriefSections(fromClient.concat(added));

  // 材料が無いのは故障ではない。degraded を立てずに空で返す
  if (sections.length === 0) {
    return NextResponse.json(empty satisfies BriefResponse);
  }

  const withCurrent = (
    seenByKey: Map<BriefSectionKey, { seen: string; sign: BriefSign }>
  ): BriefSectionPayload[] =>
    sections.map((s) => ({
      key: s.key,
      label: briefSectionLabel(s.key),
      current: s.current,
      seen: seenByKey.get(s.key)?.seen ?? '',
      sign: seenByKey.get(s.key)?.sign ?? '',
    }));

  const noSeen = new Map<BriefSectionKey, { seen: string; sign: BriefSign }>();

  if (!isClaudeConfigured()) {
    return NextResponse.json({
      ...empty,
      sections: withCurrent(noSeen),
      degraded: true,
    } satisfies BriefResponse);
  }

  const sentKeys = sections.map((s) => s.key);

  try {
    const raw = await callClaudeJson<unknown>({
      // 7つのセクションを見比べて「つなげて見えること」を出す仕事なので smart
      model: CLAUDE_MODELS.smart,
      // 書き方の決まりは毎回同じなのでキャッシュに載せる
      system: [{ text: briefSystemPrompt(), cache: true }],
      userText: briefUserText(sections),
      maxTokens: 1500,
    });

    const parsed = parseBriefResult(raw, sentKeys);
    const seenByKey = new Map<BriefSectionKey, { seen: string; sign: BriefSign }>();
    for (const s of parsed.sections) seenByKey.set(s.key, { seen: s.seen, sign: s.sign });

    /**
     * ★見えることも話す項目も1つも残らなかったら「作れなかった」に倒す。
     *   現状の行だけのカードは、画面の他のパネルの写しでしかない。
     */
    const nothing = parsed.talk.length === 0 && parsed.sections.every((s) => !s.seen);

    return NextResponse.json({
      sections: withCurrent(seenByKey),
      thread: parsed.thread,
      talk: parsed.talk,
      degraded: nothing,
      disabled: false,
    } satisfies BriefResponse);
  } catch (e) {
    const reason = e instanceof ClaudeError ? e.reason : 'unavailable';
    console.error('[ai/interview/brief] failed', reason, e);
    return NextResponse.json({
      ...empty,
      sections: withCurrent(noSeen),
      degraded: true,
    } satisfies BriefResponse);
  }
}
