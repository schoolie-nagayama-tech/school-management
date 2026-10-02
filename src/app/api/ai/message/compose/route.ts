import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { callClaudeJson, isClaudeConfigured, CLAUDE_MODELS, ClaudeError } from '@/lib/ai/claude';
import {
  parentMessageSystemPrompt,
  parentMessageUserText,
  parseParentMessageResult,
  MAX_MESSAGES,
  type ParentMessageEntry,
} from '@/lib/ai/parentMessage';
import { PARENT_MESSAGE_FEATURE_KEY } from '@/lib/ai/features';
import { formatGradeLabelOrEmpty } from '@/lib/utils/gradeLabel';
import { lookupPortalSenderRelation } from '@/lib/mypage/chatCounterpart';
import type { ChatTemplateKind } from '@/types/chat';

export const dynamic = 'force-dynamic';

/**
 * 「保護者との連絡」— 教室長の箇条書きを、そのスレッドのやりとりに合わせて文章にする。
 *
 * 送信APIは既存の POST /api/admin/portal-chat/messages のまま（保存経路を増やさない）。
 * ここは文章を作るだけで、chat_messages には一切書き込まない。
 *
 * ★教室ごとの栓を通る（parent_message・行が無ければOFF）。
 * ★出さない場面（§5.4・docs/parent-message-ai-plan.md）:
 *   - 最後の保護者メッセージが振替・欠席の構造化テンプレで終わっているスレッド
 *     （機能と定型で返す領域なので、AIには渡さない）。
 *   - 生徒本人が相手のスレッド（口語で書くので、教室長の箇条書きを整える対象ではない）。
 *     判定は portal_account_students.relation（'self'=本人 / 'guardian'・'other'=保護者）を、
 *     最後に保護者側から届いたメッセージの送信アカウントで引く。sender_kind='portal' だけでは
 *     本人か保護者かは区別できない（両方 'portal' で入ってくる）ため、この表を使う。
 *
 * 正典: docs/parent-message-ai-plan.md §5・§5.2・§5.3・§5.4
 */

interface ComposeResponse {
  body: string;
  quote: { id: string; body: string; created_at: string } | null;
  /** AIを呼べなかった。故障側 */
  degraded: boolean;
  /** この教室ではAIに送らない設定。故障ではなく意図した停止 */
  disabled: boolean;
  /** AIを呼ばずに終えた理由。呼べたときは省く */
  skipped?: 'template' | 'student';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 引用に出す本文は80字で切る（受信箱側でも1通の印にするだけなので全文は要らない） */
function truncateQuote(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
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
    threadId?: unknown;
    points?: unknown;
    instruction?: unknown;
    currentDraft?: unknown;
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

  const threadId = typeof body.threadId === 'string' ? body.threadId : '';
  if (!UUID_RE.test(threadId)) {
    return NextResponse.json({ error: 'スレッドの指定が不正です' }, { status: 400 });
  }

  const pointsRaw = typeof body.points === 'string' ? body.points.trim() : '';
  if (!pointsRaw) {
    return NextResponse.json({ error: '答えることを書いてください' }, { status: 400 });
  }
  // ★上限を超えたら切る（切り詰め自体は許容。プロンプトが際限なく伸びるのを防ぐだけで、
  //   ここは生成物ではなく人が書いた指示なので、途中で切れても書き直せば済む）
  const points = pointsRaw.length > 1000 ? pointsRaw.slice(0, 1000) : pointsRaw;

  const instruction =
    typeof body.instruction === 'string' && body.instruction.trim()
      ? body.instruction.trim().slice(0, 1000)
      : undefined;

  // ★いまの返信欄の文。作り直し（instruction あり）のときだけ使う。
  //   作り直しを箇条書きからではなくこの文に効かせ、教室長の手直しを捨てないため（§5.3）。
  //   人が書いた文なので、長すぎる分は切るだけでよい（プロンプトが際限なく伸びるのを防ぐ）
  const currentDraft =
    instruction && typeof body.currentDraft === 'string' && body.currentDraft.trim()
      ? body.currentDraft.trim().slice(0, 1000)
      : undefined;

  const empty: ComposeResponse = { body: '', quote: null, degraded: false, disabled: false };

  const supabase = getPortalServiceClient();

  /**
   * ★スレッドが本当にこの教室のものかを確かめる。school_id を信じず、
   *   chat_threads の正典を引き直す（他教室の threadId を投げるだけで読めてしまうのを防ぐ）。
   */
  const { data: thread } = await supabase
    .from('chat_threads')
    .select('id, school_id, student_id')
    .eq('id', threadId)
    .maybeSingle();

  if (!thread || (thread as { school_id: string }).school_id !== schoolId) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }
  const studentId = (thread as { student_id: string }).student_id;

  // ★この教室で「保護者との連絡」を使ってよいか（行が無ければOFF）
  const { data: setting } = await supabase
    .from('school_ai_settings')
    .select('enabled')
    .eq('school_id', schoolId)
    .eq('feature_key', PARENT_MESSAGE_FEATURE_KEY)
    .maybeSingle();

  if (!setting?.enabled) {
    return NextResponse.json({ ...empty, disabled: true } satisfies ComposeResponse);
  }

  /**
   * 材料を集める。
   * ★新しい順に取ってから古い順に並べ直す（handover/digest と同じ理由: 古い順のまま
   *   .limit() を付けると最新が入らない）。.limit() は必ず付ける（PostgRESTの1000行上限）。
   */
  const { data: rows } = await supabase
    .from('chat_messages')
    .select('id, sender_kind, sender_id, body, template_kind, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES);

  type MessageRow = {
    id: string;
    sender_kind: 'staff' | 'portal' | 'system';
    sender_id: string | null;
    body: string;
    template_kind: ChatTemplateKind | null;
    created_at: string;
  };
  const desc = (rows ?? []) as MessageRow[];
  const asc = desc.slice().reverse();

  // 最後（いちばん新しい）に保護者側（portal）から届いたメッセージ。無ければ null
  const lastPortal = desc.find((m) => m.sender_kind === 'portal') ?? null;

  // ★振替・欠席は座席表/定型で返す領域なので、その構造化テンプレで終わっているスレッドには出さない
  if (
    lastPortal &&
    (lastPortal.template_kind === 'absence' || lastPortal.template_kind === 'transfer_request')
  ) {
    return NextResponse.json({ ...empty, skipped: 'template' } satisfies ComposeResponse);
  }

  // ★生徒本人が相手のスレッドには出さない（口語で書くため）。
  //   画面側も同じ判定で欄を最初から出さない（lookupPortalSenderRelation を共有）。
  //   ここは画面を通らない呼び出しに対する最後の栓。
  const relation = await lookupPortalSenderRelation(supabase, {
    accountId: lastPortal?.sender_id ?? null,
    studentId,
  });
  if (relation === 'self') {
    return NextResponse.json({ ...empty, skipped: 'student' } satisfies ComposeResponse);
  }

  const { data: student } = await supabase
    .from('students')
    .select('grade')
    .eq('id', studentId)
    .maybeSingle();
  const gradeLabel = formatGradeLabelOrEmpty((student as { grade?: number } | null)?.grade);

  const entries: ParentMessageEntry[] = asc.map((m) => ({
    id: m.id,
    senderKind: m.sender_kind,
    body: m.body,
    createdAt: m.created_at,
  }));

  if (!isClaudeConfigured()) {
    return NextResponse.json({ ...empty, degraded: true } satisfies ComposeResponse);
  }

  try {
    const raw = await callClaudeJson<unknown>({
      model: CLAUDE_MODELS.smart,
      // 守らせる決まりは毎回同じなのでキャッシュに載せる
      system: [{ text: parentMessageSystemPrompt(), cache: true }],
      userText: parentMessageUserText({
        messages: entries,
        gradeLabel,
        points,
        instruction,
        currentDraft,
      }),
      maxTokens: 800,
    });

    const result = parseParentMessageResult(
      raw,
      entries.map((e) => e.id)
    );

    if (!result.body) {
      // ★読めなかった／短すぎる・長すぎる。中途半端に出さない
      return NextResponse.json({ ...empty, degraded: true } satisfies ComposeResponse);
    }

    const quoteEntry = result.quoteMessageId
      ? asc.find((m) => m.id === result.quoteMessageId)
      : undefined;

    return NextResponse.json({
      body: result.body,
      quote: quoteEntry
        ? {
            id: quoteEntry.id,
            body: truncateQuote(quoteEntry.body),
            created_at: quoteEntry.created_at,
          }
        : null,
      degraded: false,
      disabled: false,
    } satisfies ComposeResponse);
  } catch (e) {
    const reason = e instanceof ClaudeError ? e.reason : 'unavailable';
    console.error('[ai/message/compose] failed', reason, e);
    return NextResponse.json({ ...empty, degraded: true } satisfies ComposeResponse);
  }
}
