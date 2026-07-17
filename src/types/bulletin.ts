/** 掲示板の配信範囲（保護者ポータルv2 Stage2）。 */
export type BulletinTargetScope = 'all' | 'grade' | 'individual';

/** audience に使う値（社内＝スタッフ / 保護者 / 生徒本人）。 */
export const BULLETIN_AUDIENCES = ['社内', '保護者', '生徒'] as const;
export type BulletinAudience = (typeof BULLETIN_AUDIENCES)[number];

export interface BulletinLabel {
  id: string;
  school_id: string;
  name: string;
  color: string;
  is_system: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BulletinPost {
  id: string;
  school_id: string;
  label_id: string | null;
  title: string;
  content: string;
  link_url: string | null;
  is_pinned: boolean;
  is_archived: boolean;
  archived_at: string | null;
  /** 公開開始日時（NULL=即時公開）。この日時以降に講師へ表示・未読集計される */
  publish_start_at: string | null;
  /** 公開終了日時（NULL=無期限）。この日時を過ぎると講師には表示されない（データは残る） */
  publish_end_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  /**
   * 配信先集合（保護者ポータルv2 Stage2）。既定 ['社内']＝社内連絡（従来動作・保護者に出ない）。
   * 保護者/生徒に出すには '保護者' / '生徒' を含める。
   */
  audience?: string[];
  /** 配信範囲。'all'=全体 / 'grade'=学年指定 / 'individual'=個別生徒。既定 'all'。 */
  target_scope?: BulletinTargetScope;
  /** target_scope='grade' のときの対象学年（students.grade と一致比較）。 */
  target_grade?: number[] | null;
  // JOIN時
  label?: BulletinLabel | null;
  creator?: { display_name: string | null; email: string } | null;
  read_count?: number;
  is_read?: boolean; // 現在のユーザーが既読か
  /** 表示用：複数教室一覧時に設定される教室名 */
  school_name?: string | null;
}

/** 公開期間の状態（管理者向けのバッジ表示・フィルタ判定に使う） */
export type PublishStatus = 'scheduled' | 'active' | 'expired';

/**
 * 投稿が指定時点で公開中かどうか（公開期間内か）を判定する純関数。
 * publish_start_at / publish_end_at は NULL のとき制限なしとして扱う。
 */
export function isPostPublished(
  post: Pick<BulletinPost, 'publish_start_at' | 'publish_end_at'>,
  nowMs: number = Date.now()
): boolean {
  const start = post.publish_start_at ? new Date(post.publish_start_at).getTime() : null;
  const end = post.publish_end_at ? new Date(post.publish_end_at).getTime() : null;
  if (start != null && nowMs < start) return false;
  if (end != null && nowMs > end) return false;
  return true;
}

/** 公開期間の状態を返す（scheduled=公開前 / active=公開中 / expired=公開終了） */
export function getPublishStatus(
  post: Pick<BulletinPost, 'publish_start_at' | 'publish_end_at'>,
  nowMs: number = Date.now()
): PublishStatus {
  const start = post.publish_start_at ? new Date(post.publish_start_at).getTime() : null;
  const end = post.publish_end_at ? new Date(post.publish_end_at).getTime() : null;
  if (start != null && nowMs < start) return 'scheduled';
  if (end != null && nowMs > end) return 'expired';
  return 'active';
}

export interface BulletinRead {
  id: string;
  post_id: string;
  user_id: string;
  read_at: string;
  // JOIN時
  user?: { display_name: string | null; email: string };
}

// デフォルトラベル
export const DEFAULT_LABELS = [
  { name: '重要', color: '#ef4444', is_system: true },
  { name: '通常', color: '#4b5563', is_system: true },
];
