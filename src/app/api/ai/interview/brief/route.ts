import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import {
  callClaudeJson,
  isClaudeConfigured,
  CLAUDE_MODELS,
  ClaudeError,
  type ClaudeModel,
} from '@/lib/ai/claude';
import {
  briefSectionLabel,
  briefSystemPrompt,
  briefUserText,
  parseBriefResult,
  sanitizeBriefSections,
  sanitizeFollowUpItems,
  sanitizeFollowUpActors,
  sortBriefSections,
  dedupeConsecutiveLessonLines,
  resolveInterviewBriefModelKey,
  MAX_CURRENT_LINE_LENGTH,
  type BriefEpisode,
  type BriefFollowUp,
  type BriefSectionInput,
  type BriefSectionKey,
  type BriefSign,
  type OpenerKey,
  type SelectableModelKey,
} from '@/lib/ai/interviewBrief';
import { regionOfSchool } from '@/lib/interview/region';
import { STUDENT_DIGEST_FEATURE_KEY } from '@/lib/ai/features';

export const dynamic = 'force-dynamic';

/**
 * 面談で話すこと（面談ワークスペースの左カラム・InterviewScriptCard から呼ぶ）。
 * ★エンドポイントのパスは前身（報告事項カード）のまま据え置いている。中身の変更点は
 *   docs/interview-script-ai-plan.md §6 の「talk 廃止・bridge 追加」のみ。
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
  /**
   * 前回の約束・要望を「報告する」か「聞く」か（1件ずつ）。
   * ★渡していない item は parseBriefResult が捨てるので、返ってこなかった分は
   *   画面が出どころで振る（AIが使えない日と同じ道を通る）。
   */
  followUps: BriefFollowUp[];
  thread: string;
  /** ④の課題と⑤のプランのつながり。koushu セクションを渡していなければ常に空文字 */
  bridge: string;
  /** シーン・②の小見出しの頭の「ひとこと」。AIが書けなかった key は無い */
  openers: Partial<Record<OpenerKey, string>>;
  /**
   * 引継ぎから拾った場面。★date・teacher はAIではなく引継ぎの行から取ったもの
   * （parseBriefResult が番号で引く）
   */
  episodes: BriefEpisode[];
  /** AIを呼べなかった・読めなかった。故障側（現状の行は返しているので画面は成立する） */
  degraded: boolean;
  /** この教室ではAIに送らない設定。故障ではなく意図した停止 */
  disabled: boolean;
  /** 実際に使ったモデルのID。Sonnet 5 / Opus 5.5 の見比べで取り違えないように必ず返す */
  model: ClaudeModel;
  /** 実際に使ったモデルのキー名 */
  modelKey: SelectableModelKey;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 「授業の様子」に載せる引継ぎの回数。1回45字として900字ぶん */
const LESSON_ENTRIES = 20;
/** 画面（事実の列）に出す引継ぎの件数。AIには LESSON_ENTRIES 件ぶん全部渡す */
const LESSON_VIEW_ENTRIES = 3;
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

  let body: {
    schoolId?: unknown;
    studentId?: unknown;
    sections?: unknown;
    followUpItems?: unknown;
    model?: unknown;
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
  if (!auth.schoolIds.includes(schoolId)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const studentId = typeof body.studentId === 'string' ? body.studentId : '';
  if (!UUID_RE.test(studentId)) {
    return NextResponse.json({ error: '生徒の指定が不正です' }, { status: 400 });
  }

  /**
   * Sonnet 5 / Opus 5.5 の見比べ用モデル選択。
   * ★判定そのものは interviewBrief.ts の resolveInterviewBriefModelKey に集約してある
   *   （権限外は黙って既定に倒す・キー名以外は弾く、の2点をSupabase無しで単体テストするため）。
   */
  const modelKey: SelectableModelKey = resolveInterviewBriefModelKey(body.model, auth.role);
  const model: ClaudeModel = CLAUDE_MODELS[modelKey];

  const empty: BriefResponse = {
    sections: [],
    followUps: [],
    thread: '',
    bridge: '',
    openers: {},
    episodes: [],
    degraded: false,
    disabled: false,
    model,
    modelKey,
  };

  const supabase = getPortalServiceClient();

  /**
   * ★その生徒が本当にこの教室かを確かめる。ここを省くと、自分の教室のIDを添えて
   *   他教室の studentId を投げるだけで、引継ぎと保護者とのやりとりが読めてしまう。
   */
  const { data: student } = await supabase
    .from('students')
    // ★first_name はひとことで「◯◯さん」と呼ばせるため（クライアントの言い値にしない）
    .select('id, school_id, first_name')
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

  /**
   * ②ヒアリングの「前回の約束・要望」。★現状の行と同じ理由でクライアントが組んで送る
   * （面談画面がすでに読んでいる面談記録・タスクから作れる）。
   * ★ここで検めたものを、プロンプトと突き合わせの両方に使う。片方だけ切り詰めると、
   *   AIが正しく書き写しても「渡していない item」になって全部捨てられる。
   */
  const followUpItems = sanitizeFollowUpItems(body.followUpItems);
  // 新しいNottaの型の「塾：」「家庭：」…（誰が動くか）。本文とは別に添えてAIへ渡す
  const followUpActors = sanitizeFollowUpActors(body.followUpItems);

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

  /**
   * ★画面に出す行は、AIに渡す材料とは別に作る。
   *
   * 「授業の様子」はAIには直近20回ぶんを全部渡す。繰り返し出ている言葉（「単語が抜ける」が
   * 4回、など）は、並べて初めて見えるもので、間引くと着眼点が書けなくなる。
   * 一方で画面に20行並べると、面談中に読めるものではなくなる（実機で6行でも読みにくかった）。
   * そこで画面には件数と直近3件だけを出し、残りはAIの着眼点で読ませる。
   *
   * ★2026-09の第2段で1件→3件にした。②ヒアリングで「家庭では見えない授業の様子」を
   *   話すのに、直近1件だけでは材料にならなかった（docs/interview-workspace-layout-2026-09.md）。
   *
   * 他のセクションは行数がもともと少ないので、そのまま出す。
   */
  const viewCurrent = (s: BriefSectionInput): string[] => {
    if (s.key !== 'lessons') return s.current;
    // ★同じ講師・同じ引継ぎ文が続く塊は、いちばん新しい1件だけ残す（画面に出す3行が
    //   同じ文で埋まると材料にならない）。AIに渡す材料（sections）は畳まない
    const lines = dedupeConsecutiveLessonLines(s.current);
    if (lines.length <= LESSON_VIEW_ENTRIES + 1) return lines;
    // loadLessonLines は古い順に戻して返すので、直近は末尾。新しい順に並べ直して先頭3件を出す
    const recent = lines.slice(-LESSON_VIEW_ENTRIES).reverse();
    return [`引継ぎ ${lines.length}件`, `直近 ―― ${recent[0]}`, ...recent.slice(1)];
  };

  const withCurrent = (
    seenByKey: Map<BriefSectionKey, { seen: string; sign: BriefSign }>
  ): BriefSectionPayload[] =>
    sections.map((s) => ({
      key: s.key,
      label: briefSectionLabel(s.key),
      current: viewCurrent(s),
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
      /**
       * ★既定は best（Opus 5.5）のまま。
       *
       * 7つのセクションを突き合わせて「英語だけ成績・宿題・引継ぎが同じ方向を向いている」を
       * 見つける仕事は、1つの材料を要約するのとは別の難しさがある。materialを見比べて
       * 筋を通すところでモデルの差が出やすい。
       *
       * 面談1回につき1呼び出しで、年間でも千回の単位。単価が smart の約2.5倍でも
       * 差は年間数千円にとどまるので、質を取る（2026-09-22）。
       *
       * ★admin / owner はどちらで作るのが良いかを実データで見比べたいので、
       *   上で決めた model（smart / best）をそのまま使う。それ以外のロールは
       *   常に best（既定）になる。
       */
      model,
      // 書き方の決まりは毎回同じなのでキャッシュに載せる
      system: [{ text: briefSystemPrompt(), cache: true }],
      userText: briefUserText(sections, followUpItems, regionOfSchool(schoolId), {
        givenName: (student as { first_name?: string | null }).first_name ?? null,
        followUpActors,
      }),
      // ★長く書かせるようにしたので、出力の上限も広げる（seen 180字×7＋thread＋bridge＋followUps）。
      //   Opus 5.5 は思考が常に入り、その分も max_tokens から引かれる。4000 だと思考で食われて
      //   JSONが途中で切れる（＝作れなかったに倒れる）ので余裕を持たせる。使った分しか課金されない
      maxTokens: 16000,
      // ★Opus 5.5 の既定は medium。材料を突き合わせる仕事なので Opus 5.5 と同じ high に揃える
      effort: 'high',
    });

    // ★場面の番号は、AIに番号付きで渡した引継ぎの行（sections の lessons）で引く。
    //   画面用に畳んだ viewCurrent の行ではない（番号がずれる）
    const lessonLinesSent = sections.find((s) => s.key === 'lessons')?.current ?? [];
    const parsed = parseBriefResult(raw, sentKeys, followUpItems, lessonLinesSent);
    const seenByKey = new Map<BriefSectionKey, { seen: string; sign: BriefSign }>();
    for (const s of parsed.sections) seenByKey.set(s.key, { seen: s.seen, sign: s.sign });

    /**
     * ★見えることもつなげて見えることも1つも残らなかったら「作れなかった」に倒す。
     *   現状の行だけのカードは、画面の他のパネルの写しでしかない。
     *   ★bridge は koushu を渡していない（講習面談ではない）ときは常に空になるので、
     *     この判定には使わない。
     *   ★followUps（前回の約束・要望の振り分け）は数に入れる。ここだけ書けた日でも、
     *     「どれが報告することか」が分かるだけで②の中身が変わるため。
     */
    const nothing =
      !parsed.thread &&
      parsed.sections.every((s) => !s.seen) &&
      parsed.followUps.length === 0 &&
      Object.keys(parsed.openers).length === 0 &&
      parsed.episodes.length === 0;

    return NextResponse.json({
      sections: withCurrent(seenByKey),
      followUps: parsed.followUps,
      thread: parsed.thread,
      bridge: parsed.bridge,
      openers: parsed.openers,
      episodes: parsed.episodes,
      degraded: nothing,
      disabled: false,
      model,
      modelKey,
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
