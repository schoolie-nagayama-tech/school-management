// 増コマ申込フォームの型定義

import type { FormPeriod, FormResponse } from '@/types/database';

// 時限設定
export interface PeriodConfig {
  code: string; // '4', '5', '6', '7'
  start_time: string; // 例: "14:25"
  end_time: string; // 例: "15:55"
  available_saturday: boolean; // 土曜日に表示するか
  available_weekday: boolean; // 平日（月〜金）に表示するか
}

// 日程スケジュール設定
export interface ScheduleConfig {
  start_date: string; // 開始日（YYYY-MM-DD形式、この日から3週間分を表示）
  min_days_ahead: number; // 申込可能な最短日（本日から何日後、デフォルト: 2）
  periods: PeriodConfig[]; // 時限設定のリスト
}

// 増コマ申込フォームの設定（form_periods.settings の構造）
export interface ZoukomaSettings {
  description?: string; // 説明文
  grades?: string[]; // 対象学年リスト（例: ["中1", "中2", "中3", "高1", "高2", "高3"]）
  price_table?: Record<string, number>; // 学年別単価（例: {"中1": 3980, "中2": 3980, ...}）
  subjects?: string[]; // 科目リスト（例: ["英語", "数学", "国語", "理科", "社会"]）
  schedule?: ScheduleConfig; // 日程スケジュール設定（新形式）
  // 後方互換性のため、旧形式もサポート
  start_date?: string; // 開始日（旧形式、schedule.start_dateに移行予定）
  time_slots?: {
    // 時限設定（旧形式、schedule.periodsに移行予定）
    '4'?: string; // 例: "14:25–15:55"
    '5'?: string; // 例: "16:20–17:50"
    '6'?: string; // 例: "17:55–19:25"
    '7'?: string; // 例: "19:30–21:00"
  };
  completion_message?: string; // 完了メッセージ
}

// 増コマ申込フォームの回答データ（form_responses.response_data の構造）
export interface ZoukomaResponseData {
  subjects: Record<string, number>; // 科目ごとのコマ数（例: {"英語": 2, "数学": 3, ...}）
  total_koma: number; // 合計コマ数
  unit_price: number; // 単価（学年別）
  total_fee: number; // 合計金額
  selected_slots: Array<{
    id: string; // スロットID（例: "20241015_5"）
    label: string; // 表示ラベル（例: "10/15(火) 5限 16:20–17:50"）
  }>;
  slot_count: number; // 選択したスロット数
  note?: string; // 備考
}

// 日程スロット
export interface TimeSlot {
  id: string; // 例: "20241015_5"
  date: string; // 日付（YYYY-MM-DD）
  dayOfWeek: string; // 曜日（例: "月", "火", ...）
  period: number; // 時限（4, 5, 6, 7）
  label: string; // 表示ラベル（例: "10/15(火) 5限 16:20–17:50"）
  timeRange?: string; // 時間帯（例: "16:20–17:50"）
  isAvailable: boolean; // 選択可能かどうか（土曜4限、平日4限は不可など）
}

// 学年別の単価テーブル
export type PriceTable = Record<string, number>;

// 増コマ申込期間（form_periods の拡張型）
export type ZoukomaPeriod = FormPeriod & {
  settings: ZoukomaSettings;
};

// 増コマ申込回答（form_responses の拡張型）
export type ZoukomaResponse = FormResponse & {
  response_data: ZoukomaResponseData;
};

// 集計データ
export interface ZoukomaStats {
  total_responses: number;
  total_koma: number;
  total_fee: number;
  charged_count: number;
  seated_count: number;
  linked_count: number;
}

// 回答フィルター
export interface ZoukomaResponseFilters {
  grade?: number;
  linkedStatus?: 'all' | 'linked' | 'unlinked';
  chargedStatus?: 'all' | 'charged' | 'not_charged';
  seatedStatus?: 'all' | 'seated' | 'not_seated';
}

// 学年とgrade（数値）のマッピング
export const GRADE_NAME_TO_NUMBER: Record<string, number> = {
  '小1': 1,
  '小2': 2,
  '小3': 3,
  '小4': 4,
  '小5': 5,
  '小6': 6,
  '中1': 7,
  '中2': 8,
  '中3': 9,
  '高1': 10,
  '高2': 11,
  '高3': 12,
  '既卒': 13,
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
