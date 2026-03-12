// 模試申込フォーム関連の型定義

// 学年名と数値のマッピング（模試用）
export const MOSHI_GRADE_NAME_TO_NUMBER: Record<string, number> = {
  小4: 4,
  小5: 5,
  小6: 6,
  中1: 7,
  中2: 8,
  中3: 9,
};

export const MOSHI_GRADE_NUMBER_TO_NAME: Record<number, string> = {
  4: '小4',
  5: '小5',
  6: '小6',
  7: '中1',
  8: '中2',
  9: '中3',
};

// 模試設定
export interface MoshiSettings {
  description: string;
  grades: string[]; // 例: ["小4", "小5", "小6", "中1", "中2", "中3"]
  exam_date: string; // YYYY-MM-DD形式
  exam_date_label: string; // 例: "2月15日（日）"
  /** 本試験の時間（未指定可）。時間指定は振替受験のみ */
  exam_time?: string; // 例: "10:00〜13:00"
  furikae: {
    enabled: boolean;
    note: string;
    time_guide: {
      elementary: string; // 例: "約2時間"
      middle: string; // 例: "約3時間"
    };
    available_days: string[]; // 例: ["月", "火", "水", "木", "金"]
  };
  completion_message: string;
}

// 模試回答データ
export interface MoshiResponseData {
  exam_type: 'regular' | 'furikae';
  regular_confirmed?: boolean;
  furikae_date?: string;
  furikae_date_label?: string;
  furikae_time?: string;
  note?: string;
}

// 模試期間（form_periodsから取得）
export interface MoshiPeriod {
  id: string;
  school_id: string;
  form_type: 'moshi';
  period_key: string;
  title: string;
  settings: MoshiSettings;
  publish_start: string | null;
  publish_end: string | null;
  is_active: boolean;
  linked_application_item_id: string | null;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

// 模試回答（form_responsesから取得）
export interface MoshiResponse {
  id: string;
  school_id: string;
  form_type: 'moshi';
  form_period: string;
  student_name: string;
  grade: number;
  email: string;
  response_data: MoshiResponseData;
  linked_student_id: string | null;
  linked_at: string | null;
  status_checks: {
    charged?: boolean;
    order?: boolean; // 発注
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
export interface MoshiResponseFilters {
  grade?: number;
  examType?: 'all' | 'regular' | 'furikae';
  showArchived?: boolean;
  search?: string;
  chargedStatus?: 'all' | 'charged' | 'not_charged';
  linkedStatus?: 'all' | 'linked' | 'unlinked';
}

// 集計データ
export interface MoshiStats {
  total_responses: number;
  regular_count: number;
  furikae_count: number;
  charged_count: number;
  linked_count: number;
}
