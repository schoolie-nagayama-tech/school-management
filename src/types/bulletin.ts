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
  is_pinned: boolean;
  is_archived: boolean;
  archived_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  // JOIN時
  label?: BulletinLabel | null;
  creator?: { display_name: string | null; email: string } | null;
  read_count?: number;
  is_read?: boolean;  // 現在のユーザーが既読か
  /** 表示用：複数教室一覧時に設定される教室名 */
  school_name?: string | null;
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
