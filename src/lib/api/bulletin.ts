import { supabase } from '../supabase';
import type { BulletinLabel, BulletinPost, BulletinRead } from '@/types/bulletin';
import { DEFAULT_LABELS } from '@/types/bulletin';

/**
 * デフォルトラベルを確保（存在しない場合のみ作成）
 */
export async function ensureDefaultLabels(schoolId: string): Promise<void> {
  try {
    const { data: existingLabels, error: fetchError } = await supabase
      .from('bulletin_labels')
      .select('name')
      .eq('school_id', schoolId);

    // テーブルが存在しない場合はエラーを無視（マイグレーション未実行）
    if (fetchError) {
      console.warn(
        'bulletin_labelsテーブルが見つかりません。マイグレーションを実行してください:',
        fetchError
      );
      return;
    }

    const existingNames = new Set((existingLabels || []).map((l) => l.name));

    for (const defaultLabel of DEFAULT_LABELS) {
      if (!existingNames.has(defaultLabel.name)) {
        const { error: insertError } = await supabase.from('bulletin_labels').insert({
          school_id: schoolId,
          name: defaultLabel.name,
          color: defaultLabel.color,
          is_system: defaultLabel.is_system,
          sort_order: existingNames.size,
        });

        // RLSエラーやその他のエラーは無視（マイグレーション未実行や権限不足の場合）
        // デフォルトラベルはマイグレーションで作成されるため、ここでの作成はオプショナル
        if (insertError) {
          // エラーコード42501はRLSポリシー違反、PGRST116はテーブル不存在
          if (insertError.code === '42501' || insertError.code === 'PGRST116') {
            // マイグレーション未実行またはRLSポリシーの問題 - 警告のみ
            console.warn(
              'デフォルトラベルの作成をスキップしました（マイグレーションを実行してください）'
            );
          } else {
            console.warn(
              'デフォルトラベルの作成に失敗しました（無視します）:',
              insertError.message
            );
          }
          // エラーを無視して続行
        }
      }
    }
  } catch (error) {
    console.error('ensureDefaultLabelsでエラーが発生しました:', error);
    // エラーを無視して続行（テーブルが存在しない場合など）
  }
}

/**
 * ラベル一覧を取得
 */
export async function getBulletinLabels(schoolId: string): Promise<BulletinLabel[]> {
  // まずラベルを取得してみる
  const { data, error } = await supabase
    .from('bulletin_labels')
    .select('*')
    .eq('school_id', schoolId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  // テーブルが存在しない場合はエラーを無視（マイグレーション未実行）
  if (error) {
    if (error.code === 'PGRST116' || error.message.includes('schema cache')) {
      console.warn(
        'bulletin_labelsテーブルが見つかりません。マイグレーションを実行してください:',
        error
      );
      return [];
    }
    throw new Error(`ラベルの取得に失敗しました: ${error.message}`);
  }

  const labels = (data || []) as BulletinLabel[];

  // マイグレーションでデフォルトラベルが作成されているため、
  // ラベルが存在しない場合は空配列を返す（新しい教室の場合はマイグレーションを再実行）
  // ensureDefaultLabelsは呼ばない（RLSエラーを避けるため）

  return labels;
}

/**
 * 複数教室のラベル一覧を一括取得（school_id IN で1クエリ）
 * 教室ごとに getBulletinLabels を M 回叩いていたのを1本に畳む。
 */
export async function getBulletinLabelsBatch(
  schoolIds: string[],
  // DI: サーバーコンポーネントから RLS 認証済みクライアントを渡せる（省略時はブラウザ用、既存互換）
  client: typeof supabase = supabase
): Promise<Record<string, BulletinLabel[]>> {
  const grouped: Record<string, BulletinLabel[]> = {};
  for (const schoolId of schoolIds) grouped[schoolId] = [];
  if (schoolIds.length === 0) return grouped;

  const { data, error } = await client
    .from('bulletin_labels')
    .select('*')
    .in('school_id', schoolIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    // テーブル未作成（マイグレーション未実行）は空で返す
    if (error.code === 'PGRST116' || error.message.includes('schema cache')) {
      console.warn(
        'bulletin_labelsテーブルが見つかりません。マイグレーションを実行してください:',
        error
      );
      return grouped;
    }
    throw new Error(`ラベルの取得に失敗しました: ${error.message}`);
  }

  for (const label of (data || []) as BulletinLabel[]) {
    (grouped[label.school_id] ||= []).push(label);
  }
  return grouped;
}

/**
 * ラベルを作成
 */
export async function createBulletinLabel(
  schoolId: string,
  name: string,
  color: string
): Promise<BulletinLabel> {
  const { data, error } = await supabase
    .from('bulletin_labels')
    .insert({
      school_id: schoolId,
      name,
      color,
      is_system: false,
      sort_order: 0,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`ラベルの作成に失敗しました: ${error.message}`);
  }

  return data as BulletinLabel;
}

/**
 * ラベルを更新
 */
export async function updateBulletinLabel(
  id: string,
  updates: { name?: string; color?: string }
): Promise<BulletinLabel> {
  const { data, error } = await supabase
    .from('bulletin_labels')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`ラベルの更新に失敗しました: ${error.message}`);
  }

  return data as BulletinLabel;
}

/**
 * ラベルを削除（is_system=trueは削除不可）
 */
export async function deleteBulletinLabel(id: string): Promise<void> {
  // is_systemチェック
  const { data: label } = await supabase
    .from('bulletin_labels')
    .select('is_system')
    .eq('id', id)
    .single();

  if (label?.is_system) {
    throw new Error('システム定義のラベルは削除できません');
  }

  const { error } = await supabase.from('bulletin_labels').delete().eq('id', id);

  if (error) {
    throw new Error(`ラベルの削除に失敗しました: ${error.message}`);
  }
}

/**
 * 投稿一覧を取得
 */
export async function getBulletinPosts(
  schoolId: string,
  options?: {
    includeArchived?: boolean;
    userId?: string;
  }
): Promise<BulletinPost[]> {
  let query = supabase
    .from('bulletin_posts')
    .select(
      `
      *,
      label:bulletin_labels(*),
      creator:user_profiles!bulletin_posts_created_by_fkey(display_name, email)
    `
    )
    .eq('school_id', schoolId)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (!options?.includeArchived) {
    query = query.eq('is_archived', false);
  }

  const { data, error } = await query;

  if (error) {
    // テーブルが存在しない場合は空配列を返す
    if (error.code === 'PGRST116' || error.message.includes('schema cache')) {
      console.warn(
        'bulletin_postsテーブルが見つかりません。マイグレーションを実行してください:',
        error
      );
      return [];
    }
    throw new Error(`投稿の取得に失敗しました: ${error.message}`);
  }

  const posts = (data || []) as any[];

  // 既読情報を取得
  if (options?.userId) {
    const postIds = posts.map((p) => p.id);
    if (postIds.length > 0) {
      // 自分の既読と講師IDリストは独立しているので並列取得（シーケンシャル3クエリ → 2フェーズに削減）
      const [readsResult, teacherProfilesResult] = await Promise.all([
        supabase
          .from('bulletin_reads')
          .select('post_id')
          .eq('user_id', options.userId)
          .in('post_id', postIds),
        supabase.from('user_profiles').select('id').eq('role', 'teacher'),
      ]);

      const readPostIds = new Set((readsResult.data || []).map((r) => r.post_id));
      const teacherIds = teacherProfilesResult.data
        ? teacherProfilesResult.data.map((p) => p.id)
        : [];

      // 講師の既読数（前段の teacherIds に依存するため並列化不可）
      const { data: readCounts } = await supabase
        .from('bulletin_reads')
        .select('post_id')
        .in('post_id', postIds)
        .in(
          'user_id',
          teacherIds.length > 0 ? teacherIds : ['00000000-0000-0000-0000-000000000000']
        ); // 空配列を避けるためダミーID

      const readCountMap = new Map<string, number>();
      (readCounts || []).forEach((r) => {
        readCountMap.set(r.post_id, (readCountMap.get(r.post_id) || 0) + 1);
      });

      return posts.map((post) => ({
        ...post,
        label: post.label || null,
        creator: post.creator || null,
        is_read: readPostIds.has(post.id),
        read_count: readCountMap.get(post.id) || 0,
      })) as BulletinPost[];
    }
  }

  return posts.map((post) => ({
    ...post,
    label: post.label || null,
    creator: post.creator || null,
    is_read: false,
    read_count: 0,
  })) as BulletinPost[];
}

/**
 * 複数教室の投稿一覧を一括取得（N+1解消版）
 *
 * 旧 getBulletinPosts は教室ごとに「投稿→自分の既読→講師IDリスト→講師既読数」を
 * 直列で叩いていたため、教室数 M に対して O(M) 本のクエリが発生していた。
 * （特に「role=teacher の user_profiles 取得」は教室に依らず毎回同じ結果なのに M 回実行されていた）
 *
 * 本関数は教室数に依らず固定本数のクエリで完結する:
 *   1. bulletin_posts を school_id IN (...) で一括取得
 *   2. 自分の既読 / 講師IDリスト を並列取得
 *   3. 講師の既読（read_count 用）を一括取得（post_id はチャンク分割でURL長制限回避）
 * 結果は schoolId ごとにグループ化して返す。
 */
export async function getBulletinPostsBatch(
  schoolIds: string[],
  options?: {
    includeArchived?: boolean;
    userId?: string;
  },
  // DI: サーバーコンポーネントから RLS 認証済みのサーバークライアントを渡せるようにする
  // （省略時はブラウザ用クライアント。既存のクライアント呼び出しと完全互換）。
  client: typeof supabase = supabase
): Promise<Record<string, BulletinPost[]>> {
  if (schoolIds.length === 0) return {};

  let query = client
    .from('bulletin_posts')
    .select(
      `
      *,
      label:bulletin_labels(*),
      creator:user_profiles!bulletin_posts_created_by_fkey(display_name, email)
    `
    )
    .in('school_id', schoolIds)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (!options?.includeArchived) {
    query = query.eq('is_archived', false);
  }

  const { data, error } = await query;

  if (error) {
    // テーブル未作成（マイグレーション未実行）は空で返す
    if (error.code === 'PGRST116' || error.message.includes('schema cache')) {
      console.warn(
        'bulletin_postsテーブルが見つかりません。マイグレーションを実行してください:',
        error
      );
      return {};
    }
    throw new Error(`投稿の取得に失敗しました: ${error.message}`);
  }

  const posts = (data || []) as any[];
  const postIds = posts.map((p) => p.id);
  const userId = options?.userId;

  // 既読情報（read系）は全教室分まとめて算出する
  let readPostIds = new Set<string>();
  const readCountMap = new Map<string, number>();

  if (userId && postIds.length > 0) {
    // post_id の IN 句がURL長制限（約8KB）を超えないようチャンク分割する
    const CHUNK_SIZE = 200;
    const chunks: string[][] = [];
    for (let i = 0; i < postIds.length; i += CHUNK_SIZE) {
      chunks.push(postIds.slice(i, i + CHUNK_SIZE));
    }

    // 自分の既読と講師IDリストは互いに独立なので並列取得
    const [myReadChunks, teacherProfilesResult] = await Promise.all([
      Promise.all(
        chunks.map((chunk) =>
          client
            .from('bulletin_reads')
            .select('post_id')
            .eq('user_id', userId)
            .in('post_id', chunk)
            .then((r) => r.data || [])
        )
      ),
      client.from('user_profiles').select('id').eq('role', 'teacher'),
    ]);

    readPostIds = new Set(myReadChunks.flat().map((r) => r.post_id));

    const teacherIds = teacherProfilesResult.data
      ? teacherProfilesResult.data.map((p) => p.id)
      : [];

    // 講師の既読数（read_count）— teacherIds に依存するため上記の後で一括取得
    if (teacherIds.length > 0) {
      const teacherReadChunks = await Promise.all(
        chunks.map((chunk) =>
          client
            .from('bulletin_reads')
            .select('post_id')
            .in('post_id', chunk)
            .in('user_id', teacherIds)
            .then((r) => r.data || [])
        )
      );
      teacherReadChunks.flat().forEach((r) => {
        readCountMap.set(r.post_id, (readCountMap.get(r.post_id) || 0) + 1);
      });
    }
  }

  // schoolId ごとにグループ化しつつ既読情報を付与
  const grouped: Record<string, BulletinPost[]> = {};
  for (const schoolId of schoolIds) grouped[schoolId] = [];

  for (const post of posts) {
    const enriched = {
      ...post,
      label: post.label || null,
      creator: post.creator || null,
      is_read: userId ? readPostIds.has(post.id) : false,
      read_count: readCountMap.get(post.id) || 0,
    } as BulletinPost;
    (grouped[post.school_id] ||= []).push(enriched);
  }

  return grouped;
}

/**
 * 投稿を取得
 */
export async function getBulletinPost(id: string, userId?: string): Promise<BulletinPost | null> {
  const { data, error } = await supabase
    .from('bulletin_posts')
    .select(
      `
      *,
      label:bulletin_labels(*),
      creator:user_profiles!bulletin_posts_created_by_fkey(display_name, email)
    `
    )
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`投稿の取得に失敗しました: ${error.message}`);
  }

  const post = data as any;

  // 既読情報
  if (userId) {
    const { data: read } = await supabase
      .from('bulletin_reads')
      .select('id')
      .eq('post_id', id)
      .eq('user_id', userId)
      .single();

    post.is_read = !!read;
  }

  // 既読数
  const { data: reads } = await supabase.from('bulletin_reads').select('id').eq('post_id', id);

  post.read_count = (reads || []).length;

  return {
    ...post,
    label: post.label || null,
    creator: post.creator || null,
    is_read: post.is_read || false,
    read_count: post.read_count || 0,
  } as BulletinPost;
}

/**
 * 投稿を作成
 */
export async function createBulletinPost(
  schoolId: string,
  data: {
    title: string;
    content: string;
    label_id?: string | null;
    is_pinned?: boolean;
    link_url?: string | null;
  },
  userId?: string
): Promise<BulletinPost> {
  const { data: post, error } = await supabase
    .from('bulletin_posts')
    .insert({
      school_id: schoolId,
      label_id: data.label_id || null,
      title: data.title,
      content: data.content,
      link_url: data.link_url || null,
      is_pinned: data.is_pinned || false,
      created_by: userId || null,
      updated_by: userId || null,
    })
    .select(
      `
      *,
      label:bulletin_labels(*),
      creator:user_profiles!bulletin_posts_created_by_fkey(display_name, email)
    `
    )
    .single();

  if (error) {
    // RLSエラーの場合は詳細なメッセージを表示
    if (error.code === '42501') {
      throw new Error(
        `投稿の作成に失敗しました: RLSポリシー違反。マイグレーションを確認してください。${error.message}`
      );
    }
    throw new Error(`投稿の作成に失敗しました: ${error.message}`);
  }

  return {
    ...(post as any),
    label: (post as any).label || null,
    creator: (post as any).creator || null,
    is_read: false,
    read_count: 0,
  } as BulletinPost;
}

/**
 * 投稿を更新
 */
export async function updateBulletinPost(
  id: string,
  updates: {
    title?: string;
    content?: string;
    label_id?: string | null;
    is_pinned?: boolean;
    link_url?: string | null;
  },
  userId?: string
): Promise<BulletinPost> {
  const updateData: Record<string, unknown> = { ...updates };
  if (userId) {
    updateData.updated_by = userId;
  }

  const { data, error } = await supabase
    .from('bulletin_posts')
    .update(updateData)
    .eq('id', id)
    .select(
      `
      *,
      label:bulletin_labels(*),
      creator:user_profiles!bulletin_posts_created_by_fkey(display_name, email)
    `
    )
    .single();

  if (error) {
    throw new Error(`投稿の更新に失敗しました: ${error.message}`);
  }

  return {
    ...(data as any),
    label: (data as any).label || null,
    creator: (data as any).creator || null,
  } as BulletinPost;
}

/**
 * 投稿を削除（論理削除）
 */
export async function deleteBulletinPost(id: string): Promise<void> {
  const { error } = await supabase
    .from('bulletin_posts')
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    throw new Error(`投稿の削除に失敗しました: ${error.message}`);
  }
}

/**
 * 投稿を物理削除（管理用・通常は論理削除を使用）
 */
export async function hardDeleteBulletinPost(id: string): Promise<void> {
  const { error } = await supabase.from('bulletin_posts').delete().eq('id', id);

  if (error) {
    throw new Error(`投稿の削除に失敗しました: ${error.message}`);
  }
}

/**
 * 既読にする
 */
export async function markAsRead(postId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('bulletin_reads')
    .insert({
      post_id: postId,
      user_id: userId,
    })
    .select()
    .single();

  // 既に既読の場合はエラーを無視
  if (error && error.code !== '23505') {
    throw new Error(`既読の記録に失敗しました: ${error.message}`);
  }
}

/**
 * 既読者一覧を取得（講師のみ）
 */
export async function getPostReaders(postId: string): Promise<BulletinRead[]> {
  // まず講師のuser_idを取得
  const { data: teacherProfiles } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('role', 'teacher');

  if (!teacherProfiles || teacherProfiles.length === 0) {
    return [];
  }

  const teacherIds = teacherProfiles.map((p) => p.id);

  const { data, error } = await supabase
    .from('bulletin_reads')
    .select(
      `
      *,
      user:user_profiles!bulletin_reads_user_id_fkey(display_name, email)
    `
    )
    .eq('post_id', postId)
    .in('user_id', teacherIds)
    .order('read_at', { ascending: false });

  if (error) {
    throw new Error(`既読者の取得に失敗しました: ${error.message}`);
  }

  return (data || []).map((r: Record<string, unknown>) => ({
    ...r,
    user: r.user || null,
  })) as BulletinRead[];
}

/**
 * 未読件数を取得
 */
export async function getUnreadCount(schoolId: string, userId: string): Promise<number> {
  // 投稿IDのみ取得（データ転送を最小化）
  const { data: posts } = await supabase
    .from('bulletin_posts')
    .select('id')
    .eq('school_id', schoolId)
    .eq('is_archived', false);

  if (!posts || posts.length === 0) {
    return 0;
  }

  const postIds = posts.map((p) => p.id);

  // URL長制限（8KB）回避のため200件ずつチャンク分割してDB側でカウント
  const CHUNK_SIZE = 200;
  const chunks: string[][] = [];
  for (let i = 0; i < postIds.length; i += CHUNK_SIZE) {
    chunks.push(postIds.slice(i, i + CHUNK_SIZE));
  }

  const counts = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from('bulletin_reads')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('post_id', chunk)
        .then((r) => r.count ?? 0)
    )
  );

  const totalRead = counts.reduce((sum, c) => sum + c, 0);
  return postIds.length - totalRead;
}
