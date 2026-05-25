// 通常シフト提出機能の型定義（曜日×時間帯マトリクス）

export type RegularShiftStatus = 'draft' | 'published';

export interface RegularShiftSetting {
  id: string;
  school_id: string;
  name: string;
  deadline: string | null;
  description: string | null;
  weekday_slots: string; // comma-separated time ranges "14:45-16:15,16:20-17:50"
  saturday_slots: string;
  status: RegularShiftStatus;
  created_at: string;
  updated_at: string;
}

export interface RegularShiftSettingInsert {
  school_id: string;
  name: string;
  deadline?: string | null;
  description?: string | null;
  weekday_slots: string;
  saturday_slots: string;
  status?: RegularShiftStatus;
}

/** 開講コマ設定（曜日×時間帯ごと） */
export interface RegularShiftSlotSetting {
  id?: string;
  setting_id: string;
  day_of_week: number; // 0=日, 1=月, ..., 6=土
  time_slot: string; // HH:MM-HH:MM
  is_open: boolean;
  created_at?: string;
}

/** マトリクス表示用セル（設定画面・講師フォーム） */
export interface RegularShiftSlotMatrixCell {
  dayOfWeek: number;
  timeSlot: string;
  isOpen: boolean;
  checked?: boolean; // 講師フォーム用
}

export interface RegularShiftSubmission {
  id: string;
  setting_id: string;
  school_id: string;
  teacher_name: string;
  teacher_email: string;
  submitted_at: string;
  notes: string;
  allow_edit: boolean;
  edit_token: string;
  seat_chart_entered: boolean;
  /** 紐づけ済みアカウント (user_profiles.id)。未紐づけは null */
  user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegularShiftSubmissionInsert {
  setting_id: string;
  school_id: string;
  teacher_name: string;
  teacher_email: string;
  notes?: string;
}

export interface RegularShiftSubmissionSlot {
  id: string;
  submission_id: string;
  day_of_week: number; // 0=日, 1=月, ..., 6=土
  time_slot: string;
  available: boolean;
  created_at: string;
}

export interface RegularShiftSubmissionSlotInsert {
  submission_id: string;
  day_of_week: number;
  time_slot: string;
  available: boolean;
}

export interface RegularShiftSubmissionWithSlots extends RegularShiftSubmission {
  slots?: RegularShiftSubmissionSlot[];
}
