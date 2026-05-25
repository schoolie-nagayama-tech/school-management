/**
 * 生徒版 seasonal-shifts の型定義
 *
 * 講師版 (seasonal-shift.ts) と対称構造。
 * setting (seasonal_shift_settings) は共通流用、submission 系のみ新規型。
 */

export interface SeasonalShiftStudentSubmission {
  id: string;
  setting_id: string;
  school_id: string;
  student_id: string;
  submitter_email: string | null;
  submitter_name: string | null;
  submitted_at: string;
  notes: string | null;
  allow_edit: boolean;
  edit_token: string | null;
  /** 「マッチング提案に組み込み済み」フラグ。室長が消化済みかを管理 */
  matching_consumed: boolean;
  created_at: string;
  updated_at: string;
  // join
  student?: { id: string; last_name: string; first_name: string; grade: number };
  slots?: SeasonalShiftStudentSubmissionSlot[];
}

export interface SeasonalShiftStudentSubmissionSlot {
  id: string;
  submission_id: string;
  shift_date: string;
  /** 'HH:MM-HH:MM' */
  time_slot: string;
  available: boolean;
  created_at: string;
}

/** 保護者ポータル経由の送信ペイロード */
export interface StudentSubmissionFormData {
  setting_id: string;
  student_id: string;
  submitter_email: string;
  submitter_name: string;
  notes: string;
  /** チェックされた (shift_date, time_slot) の組み合わせ */
  selected_slots: Array<{ shift_date: string; time_slot: string }>;
}
