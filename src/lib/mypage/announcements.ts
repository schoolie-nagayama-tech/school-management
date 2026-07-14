import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPortalServiceClient } from './serviceClient';
import { isPostPublished } from '@/types/bulletin';

/**
 * 保護者ポータルのお知らせ（掲示板 audience 拡張）。
 *
 * 正典: docs/portal-v2-requirements.md §7-2「掲示板 audience 拡張」。
 *   一覧取得は portal クライアント（RLS: audience に保護者/生徒を含み、target_scope に
 *   応じて全体/自分の紐づけ生徒の学年/個別に該当する投稿のみ）で行う。既読は別テーブル
 *   bulletin_portal_reads に service role で記録する。
 *
 * ★ bulletin_labels は portal に grant していないため JOIN しない（必要フィールドのみ）。
 */

/** ポータルお知らせ1件（表示用）。 */
export interface PortalAnnouncement {
  id: string;
  title: string;
  content: string;
  link_url: string | null;
  is_pinned: boolean;
  publish_start_at: string | null;
  publish_end_at: string | null;
  created_at: string;
  is_read: boolean;
}

/**
 * 自分（portal）に配信されたお知らせ一覧。
 * @param client     portal クライアント（RLS越し）。
 * @param _accountId  portal_account_id（呼び出し側の意図明示用。既読は RLS が自分の行だけに絞る）。
 */
export async function getPortalAnnouncements(
  client: SupabaseClient,
  _accountId: string
): Promise<PortalAnnouncement[]> {
  // RLS が audience/target で絞る。アーカイブ済みは除外。
  const { data, error } = await client
    .from('bulletin_posts')
    .select(
      'id, title, content, link_url, is_pinned, publish_start_at, publish_end_at, created_at, is_archived'
    )
    .eq('is_archived', false)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[mypage/announcements] 取得に失敗:', error.message);
    return [];
  }

  const posts = (data ?? []) as {
    id: string;
    title: string;
    content: string;
    link_url: string | null;
    is_pinned: boolean;
    publish_start_at: string | null;
    publish_end_at: string | null;
    created_at: string;
  }[];

  // 公開期間外（公開前・終了後）は出さない（RLSは期間を見ないのでアプリ層で絞る）。
  const now = Date.now();
  const visible = posts.filter((p) => isPostPublished(p, now));
  if (visible.length === 0) return [];

  // 既読（自分の bulletin_portal_reads）。portal は自分の行のみ SELECT 可。
  const ids = visible.map((p) => p.id);
  const { data: reads } = await client
    .from('bulletin_portal_reads')
    .select('post_id')
    .in('post_id', ids);
  const readSet = new Set((reads ?? []).map((r: { post_id: string }) => r.post_id));

  return visible.map((p) => ({ ...p, is_read: readSet.has(p.id) }));
}

/**
 * お知らせを既読にする（service role・bulletin_portal_reads に upsert）。
 * 可視性チェック: 念のため対象投稿が本当にそのアカウントに配信されているかは
 * portal RLS 側で担保される（見えない投稿の既読を作っても実害はないが、既読は
 * 表示に紐づくため通常は一覧に出た投稿にしか呼ばれない）。
 */
export async function markPortalAnnouncementRead(
  accountId: string,
  postId: string,
  client?: SupabaseClient
): Promise<void> {
  const svc = client ?? getPortalServiceClient();
  const { error } = await svc
    .from('bulletin_portal_reads')
    .upsert(
      { post_id: postId, portal_account_id: accountId, read_at: new Date().toISOString() },
      { onConflict: 'post_id,portal_account_id', ignoreDuplicates: true }
    );
  if (error) console.error('[mypage/announcements] 既読記録に失敗:', error.message);
}
