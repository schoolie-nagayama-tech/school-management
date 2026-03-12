// 曜日変更フォーム関連の型定義

// 学年名と数値のマッピング
export const YOUBI_GRADE_NAME_TO_NUMBER: Record<string, number> = {
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

export const YOUBI_GRADE_NUMBER_TO_NAME: Record<number, string> = {
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

// 科目設定（名前＋授業時間）— shukaisu と共通形式
export type YoubiAvailableSubjectEntry = string | { name: string; duration_minutes: number };

/** settings.available_subjects から科目名を取得するヘルパー */
export function getYoubiSubjectName(entry: YoubiAvailableSubjectEntry): string {
  return typeof entry === 'string' ? entry : entry.name;
}

/** settings.available_subjects から授業時間を取得するヘルパー */
export function getYoubiSubjectDuration(entry: YoubiAvailableSubjectEntry): number {
  return typeof entry === 'string' ? 90 : entry.duration_minutes;
}

// 曜日変更設定
export interface YoubiSettings {
  description: string;
  available_days: string[];
  available_periods: Array<{
    code: string;
    label: string;
  }>;
  available_subjects: YoubiAvailableSubjectEntry[];
  completion_message: string;
}

// スロット情報
export interface YoubiSlot {
  day: string;
  period: string;
  period_label: string;
  subject: string;
  duration_minutes?: number;
}

// 曜日変更回答データ
export interface YoubiResponseData {
  current: YoubiSlot;
  request1: YoubiSlot;
  request2: YoubiSlot;
  change_from: string;
  change_from_label: string;
  note?: string;
}

// 曜日変更期間（form_periodsから取得）
export interface YoubiPeriod {
  id: string;
  school_id: string;
  form_type: 'youbi';
  period_key: string;
  title: string;
  settings: YoubiSettings;
  publish_start: string | null;
  publish_end: string | null;
  is_active: boolean;
  linked_application_item_id: string | null;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

// 曜日変更回答（form_responsesから取得）
export interface YoubiResponse {
  id: string;
  school_id: string;
  form_type: 'youbi';
  form_period: string;
  student_name: string;
  grade: number;
  email: string;
  response_data: YoubiResponseData;
  linked_student_id: string | null;
  linked_at: string | null;
  status_checks: {
    charged?: boolean;
    seated?: boolean;
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
export interface YoubiResponseFilters {
  grade?: number;
  showArchived?: boolean;
  search?: string;
  handledStatus?: 'all' | 'handled' | 'not_handled';
  linkedStatus?: 'all' | 'linked' | 'unlinked';
}

// 集計データ
export interface YoubiStats {
  total_responses: number;
  handled_count: number;
  linked_count: number;
}
