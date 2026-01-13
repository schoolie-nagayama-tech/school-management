// Vもぎ申込フォーム関連の型定義

// 学年名と数値のマッピング
export const GRADE_NAME_TO_NUMBER: Record<string, number> = {
  小1: 1,
  小2: 2,
  小3: 3,
  小4: 4,
  小5: 5,
  小6: 6,
  中1: 7,
  中2: 8,
  中3: 9,
  高1: 10,
  高2: 11,
  高3: 12,
  既卒: 13,
};

export const GRADE_NUMBER_TO_NAME: Record<number, string> = {
  1: '小1',
  2: '小2',
  3: '小3',
  4: '小4',
  5: '小5',
  6: '小6',
  7: '中1',
  8: '中2',
  9: '中3',
  10: '高1',
  11: '高2',
  12: '高3',
  13: '既卒',
};

// 会場情報
export interface Venue {
  id: string;
  label: string;
}

// 日程情報
export interface MogiDate {
  id: string; // YYYY-MM-DD形式
  label: string; // 表示用ラベル（例: "10月6日（日）"）
  venues: Venue[];
}

// Vもぎ設定
export interface MogiSettings {
  description?: string;
  grades?: string[]; // 例: ["中3", "高1"]
  dates?: MogiDate[];
  completion_message?: string;
}

// 選択された日程・会場
export interface DateVenueSelection {
  date_id: string;
  date_label: string;
  venue_id: string;
  venue_label: string;
}

// Vもぎ回答データ
export interface MogiResponseData {
  selections: DateVenueSelection[];
  selection_count: number;
  cancel_agreed: boolean;
  note?: string;
}

// Vもぎ期間（form_periodsから取得）
export interface MogiPeriod {
  id: string;
  school_id: string;
  form_type: 'mogi';
  period_key: string;
  title: string;
  settings: MogiSettings;
  publish_start: string | null;
  publish_end: string | null;
  is_active: boolean;
  linked_application_item_id: string | null;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

// Vもぎ回答（form_responsesから取得）
export interface MogiResponse {
  id: string;
  school_id: string;
  form_type: 'mogi';
  form_period: string;
  student_name: string;
  grade: number;
  email: string;
  response_data: MogiResponseData;
  linked_student_id: string | null;
  linked_at: string | null;
  status_checks: {
    charged?: boolean;
  } | null;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  linked_student?: {
    id: string;
    last_name: string;
    first_name: string;
  } | null;
}

// フィルター
export interface MogiResponseFilters {
  grade?: number;
  dateId?: string;
  venueId?: string;
  chargedStatus?: 'charged' | 'not_charged';
  linkedStatus?: 'linked' | 'unlinked';
  showArchived?: boolean;
}

// 集計データ
export interface MogiStats {
  total_responses: number;
  date_venue_counts: Array<{
    date_id: string;
    date_label: string;
    venue_counts: Array<{
      venue_id: string;
      venue_label: string;
      count: number;
    }>;
    total: number;
  }>;
  charged_count: number;
  linked_count: number;
}
