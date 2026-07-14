import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPortalServiceClient } from './serviceClient';
import type {
  ChatSenderKind,
  ChatTemplateKind,
  ChatTemplatePayload,
  ChatMessage,
} from '@/types/chat';

/**
 * チャットの DB 操作（service role・RLSバイパス）。
 *
 * 正典: docs/portal-v2-requirements.md §7-2。
 *   書き込み（投稿・システムメッセージ・既読）と、スタッフ側の閲覧はすべて service role
 *   経由のこのモジュールに集約する（chat_* は portal ロール以外に SELECT ポリシーを
 *   作らない = スタッフも service role API 経由で扱う設計）。
 *
 * 認可（誰がどのスレッドに書けるか）は各 API ルート側で担保する:
 *   - 保護者: ポータルJWTの sub（portal_account_id）が対象生徒に紐づくか検証（verifyPortalLink）。
 *   - スタッフ: requireManager ＋ 教室スコープ（thread.school_id ∈ 自分の schoolIds）。
 */

/** 既定の service role クライアント。 */
function db(client?: SupabaseClient): SupabaseClient {
  return client ?? getPortalServiceClient();
}

/**
 * ポータルアカウントが対象生徒に紐づいているか（authorization の基点）。
 * 退塾失効は students 側の話なので、ここでは「紐づけ行の存在」だけを見る。
 */
export async function verifyPortalLink(
  portalAccountId: string,
  studentId: string,
  client?: SupabaseClient
): Promise<boolean> {
  const { data, error } = await db(client)
    .from('portal_account_students')
    .select('account_id')
    .eq('account_id', portalAccountId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (error) {
    console.error('[chatService] 紐づけ検証に失敗:', error.message);
    return false;
  }
  return !!data;
}

/**
 * 生徒のスレッドを取得（無ければ作成）。生徒ごと1スレッド（student_id unique）。
 * @param createdBy 作成スタッフの user_profiles.id（保護者初回発信なら null）
 */
export async function resolveThreadForStudent(
  studentId: string,
  createdBy: string | null,
  client?: SupabaseClient
): Promise<{ id: string; school_id: string } | null> {
  const supabase = db(client);

  // 既存スレッド
  const { data: existing, error: exErr } = await supabase
    .from('chat_threads')
    .select('id, school_id')
    .eq('student_id', studentId)
    .maybeSingle();
  if (exErr) {
    console.error('[chatService] スレッド取得に失敗:', exErr.message);
    return null;
  }
  if (existing) return existing as { id: string; school_id: string };

  // 生徒の所属校を取得してスレッドを作る
  const { data: student, error: stErr } = await supabase
    .from('students')
    .select('id, school_id')
    .eq('id', studentId)
    .maybeSingle();
  if (stErr || !student) {
    console.error('[chatService] スレッド作成: 生徒取得に失敗:', stErr?.message);
    return null;
  }

  // student_id unique の競合（並行作成）は onConflict で既存を拾い直す。
  const { error: insErr } = await supabase
    .from('chat_threads')
    .upsert(
      {
        student_id: studentId,
        school_id: (student as { school_id: string }).school_id,
        created_by: createdBy,
      },
      { onConflict: 'student_id', ignoreDuplicates: true }
    );
  if (insErr) {
    console.error('[chatService] スレッド作成に失敗:', insErr.message);
    return null;
  }
  const { data: created } = await supabase
    .from('chat_threads')
    .select('id, school_id')
    .eq('student_id', studentId)
    .maybeSingle();
  return (created as { id: string; school_id: string } | null) ?? null;
}

/** スレッドに参加者（ポータルアカウント）を追加（冪等）。 */
export async function ensureParticipant(
  threadId: string,
  portalAccountId: string,
  client?: SupabaseClient
): Promise<void> {
  const { error } = await db(client)
    .from('chat_thread_participants')
    .upsert(
      { thread_id: threadId, portal_account_id: portalAccountId },
      { onConflict: 'thread_id,portal_account_id', ignoreDuplicates: true }
    );
  if (error) console.error('[chatService] 参加者追加に失敗:', error.message);
}

/** メッセージを1件挿入して返す。 */
export async function insertMessage(
  params: {
    threadId: string;
    senderKind: ChatSenderKind;
    senderId: string | null;
    body: string;
    templateKind?: ChatTemplateKind | null;
    payload?: ChatTemplatePayload | null;
  },
  client?: SupabaseClient
): Promise<ChatMessage | null> {
  const { data, error } = await db(client)
    .from('chat_messages')
    .insert({
      thread_id: params.threadId,
      sender_kind: params.senderKind,
      sender_id: params.senderId,
      body: params.body,
      template_kind: params.templateKind ?? null,
      payload: params.payload ?? null,
    })
    .select('id, thread_id, sender_kind, sender_id, body, template_kind, payload, created_at')
    .single();
  if (error) {
    console.error('[chatService] メッセージ挿入に失敗:', error.message);
    return null;
  }
  return data as ChatMessage;
}

/** メッセージ一覧（時系列昇順）。 */
export async function listMessages(
  threadId: string,
  client?: SupabaseClient
): Promise<ChatMessage[]> {
  const { data, error } = await db(client)
    .from('chat_messages')
    .select('id, thread_id, sender_kind, sender_id, body, template_kind, payload, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[chatService] メッセージ一覧に失敗:', error.message);
    return [];
  }
  return (data ?? []) as ChatMessage[];
}

/** 既読ポインタを更新（now で upsert）。reader_kind: staff|portal。 */
export async function markRead(
  params: { threadId: string; readerKind: 'staff' | 'portal'; readerId: string },
  client?: SupabaseClient
): Promise<void> {
  const { error } = await db(client).from('chat_reads').upsert(
    {
      thread_id: params.threadId,
      reader_kind: params.readerKind,
      reader_id: params.readerId,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: 'thread_id,reader_kind,reader_id' }
  );
  if (error) console.error('[chatService] 既読更新に失敗:', error.message);
}

/**
 * reader にとっての未読件数（自分以外が送ったメッセージのうち last_read_at より後）。
 */
export async function unreadCountForReader(
  params: { threadId: string; readerKind: 'staff' | 'portal'; readerId: string },
  client?: SupabaseClient
): Promise<number> {
  const supabase = db(client);
  const { data: read } = await supabase
    .from('chat_reads')
    .select('last_read_at')
    .eq('thread_id', params.threadId)
    .eq('reader_kind', params.readerKind)
    .eq('reader_id', params.readerId)
    .maybeSingle();
  const lastReadAt = (read as { last_read_at: string } | null)?.last_read_at ?? '1970-01-01';

  // 自分が送った側（staff→staff発言 / portal→portal発言）は未読に数えない。
  const ownKind = params.readerKind;
  const { count, error } = await supabase
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', params.threadId)
    .gt('created_at', lastReadAt)
    .neq('sender_kind', ownKind);
  if (error) {
    console.error('[chatService] 未読カウントに失敗:', error.message);
    return 0;
  }
  return count ?? 0;
}

/** 生徒に紐づくポータルアカウントID一覧（通知先解決・参加者追加に使う）。 */
export async function portalAccountIdsForStudent(
  studentId: string,
  client?: SupabaseClient
): Promise<string[]> {
  const { data, error } = await db(client)
    .from('portal_account_students')
    .select('account_id')
    .eq('student_id', studentId);
  if (error) {
    console.error('[chatService] 紐づけアカウント取得に失敗:', error.message);
    return [];
  }
  return (data ?? []).map((r: { account_id: string }) => r.account_id);
}
