// 週回数変更フォーム関連の型定義

// 学年名と数値のマッピング
export const SHUKAISU_GRADE_NAME_TO_NUMBER: Record<string, number> = {
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
};

export const SHUKAISU_GRADE_NUMBER_TO_NAME: Record<number, string> = {
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
};

// 週回数変更設定
export interface ShukaisuSettings {
  description: string;
  available_days: string[];
  available_periods: Array<{
    code: string;
    label: string;
  }>;
  available_subjects: string[];
  weekly_options: number[];
  completion_message: string;
}

// スロット情報
export interface ShukaisuSlot {
  day: string;
  period: string;
  period_label: string;
  subject: string;
}

// 週回数変更回答データ
export interface ShukaisuResponseData {
  current: {
    weekly_count: number;
    slots: ShukaisuSlot[];
  };
  requested: {
    weekly_count: number;
    slots: ShukaisuSlot[];
  };
  change_from: string;
  change_from_label: string;
  note?: string;
}

// 週回数変更期間（form_periodsから取得）
export interface ShukaisuPeriod {
  id: string;
  school_id: string;
  form_type: 'shukaisu';
  period_key: string;
  title: string;
  settings: ShukaisuSettings;
  publish_start: string | null;
  publish_end: string | null;
  is_active: boolean;
  linked_application_item_id: string | null;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

// 週回数変更回答（form_responsesから取得）
export interface ShukaisuResponse {
  id: string;
  school_id: string;
  form_type: 'shukaisu';
  form_period: string;
  student_name: string;
  grade: number;
  email: string;
  response_data: ShukaisuResponseData;
  linked_student_id: string | null;
  linked_at: string | null;
  status_checks: {
    handled?: boolean;
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
export interface ShukaisuResponseFilters {
  grade?: number;
  showArchived?: boolean;
  search?: string;
  handledStatus?: 'all' | 'handled' | 'not_handled';
  linkedStatus?: 'all' | 'linked' | 'unlinked';
}

// 集計データ
export interface ShukaisuStats {
  total_responses: number;
  handled_count: number;
  linked_count: number;
}
