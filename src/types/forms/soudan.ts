// お客様相談フォーム関連の型定義

// 学年名と数値のマッピング
export const SOUDAN_GRADE_NAME_TO_NUMBER: Record<string, number> = {
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

export const SOUDAN_GRADE_NUMBER_TO_NAME: Record<number, string> = {
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

// お客様相談設定
export interface SoudanSettings {
  description: string;
  categories: string[];
  completion_message: string;
}

// お客様相談回答データ
export interface SoudanResponseData {
  categories: string[]; // 相談区分（複数選択可）
  content: string;
  phone?: string; // 電話番号（任意）
  student_name?: string; // 生徒名（任意）
  grade?: number; // 学年（任意）
  email?: string; // メールアドレス（任意）
}

// お客様相談期間（form_periodsから取得）
export interface SoudanPeriod {
  id: string;
  school_id: string;
  form_type: 'soudan';
  period_key: string;
  title: string;
  settings: SoudanSettings;
  publish_start: string | null;
  publish_end: string | null;
  is_active: boolean;
  linked_application_item_id: string | null;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

// お客様相談回答（form_responsesから取得）
export interface SoudanResponse {
  id: string;
  school_id: string;
  form_type: 'soudan';
  form_period: string;
  student_name: string;
  grade: number;
  email: string;
  response_data: SoudanResponseData;
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
  // response_dataから取得した情報（後方互換性のため）
  response_data_phone?: string;
  response_data_student_name?: string;
  response_data_grade?: number;
  response_data_email?: string;
}

// フィルター
export interface SoudanResponseFilters {
  grade?: number;
  category?: string | null;
  showArchived?: boolean;
  search?: string;
  handledStatus?: 'all' | 'handled' | 'not_handled';
  linkedStatus?: 'all' | 'linked' | 'unlinked';
}

// 集計データ
export interface SoudanStats {
  total_responses: number;
  handled_count: number;
  linked_count: number;
  category_counts: Array<{
    category: string;
    count: number;
  }>;
}
