// 講習期間シフト提出機能の型定義

export type SeasonalShiftStatus = 'draft' | 'published';

export interface SeasonalShiftSetting {
  id: string;
  school_id: string;
  name: string;
  start_date: string;
  end_date: string;
  deadline: string;
  description: string;
  weekday_slots: string;
  saturday_slots: string;
  status: SeasonalShiftStatus;
  created_at: string;
  updated_at: string;
}

export interface SeasonalShiftSettingInsert {
  school_id: string;
  name: string;
  start_date: string;
  end_date: string;
  deadline: string;
  description?: string;
  weekday_slots: string;
  saturday_slots: string;
  status?: SeasonalShiftStatus;
}

/** 開講コマ設定（日付×時間帯ごと） */
export interface SlotSetting {
  id?: string;
  setting_id: string;
  slot_date: string; // YYYY-MM-DD
  time_slot: string; // HH:MM-HH:MM
  is_open: boolean;
  created_at?: string;
}

/** マトリクス表示用セル（設定画面・講師フォーム） */
export interface SlotMatrixCell {
  date: Date;
  timeSlot: string;
  isOpen: boolean;
  isSunday: boolean;
  checked?: boolean; // 講師フォーム用
}

export interface SeasonalShiftSubmission {
  id: string;
  setting_id: string;
  school_id: string;
  teacher_name: string;
  teacher_email: string;
  submitted_at: string;
  notes: string;
  allow_edit: boolean;
  edit_token: string;
  seat_chart_entered?: boolean;
  created_at: string;
  updated_at: string;
}

export interface SeasonalShiftSubmissionInsert {
  setting_id: string;
  school_id: string;
  teacher_name: string;
  teacher_email: string;
  notes?: string;
}

export interface SeasonalShiftSubmissionSlot {
  id: string;
  submission_id: string;
  shift_date: string;
  time_slot: string;
  available: boolean;
  created_at: string;
}

export interface SeasonalShiftSubmissionSlotInsert {
  submission_id: string;
  shift_date: string;
  time_slot: string;
  available: boolean;
}

export interface SubmissionWithSlots extends SeasonalShiftSubmission {
  slots?: SeasonalShiftSubmissionSlot[];
}
