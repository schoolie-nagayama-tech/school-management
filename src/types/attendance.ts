// コマ種別
export interface AttendanceType {
  id: string;
  school_id: string;
  name: string;
  unit: 'count' | 'hours';
  unit_price: number;
  display_order: number;
  is_active: boolean;
  is_class_type: boolean;
  created_at: string;
  updated_at: string;
}

// 出勤簿ステータス
export type AttendanceSheetStatus = 'draft' | 'submitted' | 'reviewed' | 'approved' | 'rejected';

// 出勤簿ヘッダー
export interface AttendanceSheet {
  id: string;
  teacher_id: string;
  school_id: string;
  year_month: string;
  status: AttendanceSheetStatus;
  submitted_at: string | null;
  /** 提出ボタンを押した人。teacher_id と違えば代理提出（列を追加する前の提出は null） */
  submitted_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  submitted_to: string | null;
  rejection_reason: string | null;
  transport_cost: number;
  admin_note: string | null;
  /** 1対2・1対1のいずれかにコマ給変更があるか（導出フラグ） */
  is_koma_changing: boolean;
  /** コマ給変更(1対2)。指導形態ごとに別建てなので 1対1 とは別カラムで持つ */
  koma_change_from: number | null;
  koma_change_to: number | null;
  /** コマ給変更(1対1) */
  koma_change_from_1to1: number | null;
  koma_change_to_1to1: number | null;
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

// コマ給変更の指導形態。1対2 は既存カラム(koma_change_from/to)、1対1 は _1to1 カラムに対応する
export type KomaChangeFormat = '1to2' | '1to1';

export const KOMA_CHANGE_FORMAT_LABELS: Record<KomaChangeFormat, string> = {
  '1to2': '1対2',
  '1to1': '1対1',
};

// コマ給変更の入力値（1講師・1ヶ月ぶん）。片方だけの変更もあるため各枠は独立に null を取る
export interface KomaChangeInput {
  from_1to2: number | null;
  to_1to2: number | null;
  from_1to1: number | null;
  to_1to1: number | null;
}

// フォーム用
export interface AttendanceTypeFormData {
  name: string;
  unit: 'count' | 'hours';
  unit_price: number;
  display_order: number;
  is_active: boolean;
  is_class_type: boolean;
}

// ステータスラベル
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceSheetStatus, string> = {
  draft: '入力中',
  submitted: '提出済み',
  reviewed: '確認済み',
  approved: '承認済み',
  rejected: '修正',
};

/**
 * 提出までの流れ（画面の説明表示用）。
 *
 * 実際の遷移と対で持つこと:
 *   draft →(講師が提出) submitted →(教室長が確認) reviewed →(管理者が承認) approved
 * 差戻は rejectToTeacher(submitted→rejected) / rejectToManager(reviewed→submitted)。
 * rejected は分岐なのでこの直線の流れには含めない。
 */
export const ATTENDANCE_FLOW_STEPS: { status: AttendanceSheetStatus; actor: string }[] = [
  { status: 'draft', actor: '講師が入力' },
  { status: 'submitted', actor: '講師が提出' },
  { status: 'reviewed', actor: '教室長が確認' },
  { status: 'approved', actor: '管理者が承認' },
];

// ステータスカラー
export const ATTENDANCE_STATUS_COLORS: Record<AttendanceSheetStatus, string> = {
  draft: 'bg-gray-100 text-gray-800',
  submitted: 'bg-yellow-100 text-yellow-800',
  reviewed: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};
