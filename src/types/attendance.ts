// コマ種別
export interface AttendanceType {
  id: string;
  school_id: string;
  name: string;
  unit: 'count' | 'hours';
  unit_price: number;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// 出勤簿ステータス
export type AttendanceSheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

// 出勤簿ヘッダー
export interface AttendanceSheet {
  id: string;
  teacher_id: string;
  school_id: string;
  year_month: string;
  status: AttendanceSheetStatus;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  // リレーション
  teacher?: {
    id: string;
    name: string;
  } | null;
  school?: {
    id: string;
    name: string;
    code: string | null;
  } | null;
}

// 出勤簿明細
export interface AttendanceRecord {
  id: string;
  sheet_id: string;
  date: string;
  attendance_type_id: string;
  value: number;
  created_at: string;
  updated_at: string;
  // リレーション
  attendance_type?: AttendanceType;
}

// 遅刻早退・備考
export interface AttendanceNote {
  id: string;
  sheet_id: string;
  date: string;
  late_early: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// フォーム用
export interface AttendanceTypeFormData {
  name: string;
  unit: 'count' | 'hours';
  unit_price: number;
  display_order: number;
  is_active: boolean;
}

// ステータスラベル
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceSheetStatus, string> = {
  draft: '入力中',
  submitted: '提出済み',
  approved: '承認済み',
  rejected: '修正',
};

// ステータスカラー
export const ATTENDANCE_STATUS_COLORS: Record<AttendanceSheetStatus, string> = {
  draft: 'bg-gray-100 text-gray-800',
  submitted: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};
