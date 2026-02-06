// コマ時間マスタ
export interface ScheduleTimeSlot {
  id: string;
  school_id: string;
  slot_number: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface ScheduleTimeSlotFormData {
  slot_number: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  display_order: number;
}

// 休講日
export interface ScheduleClosedDay {
  id: string;
  school_id: string | null;
  closed_date: string;
  reason: string | null;
  is_global: boolean;
  created_at: string;
}

export interface ScheduleClosedDayFormData {
  closed_date: string;
  reason: string;
  is_global: boolean;
}

// 期間タイプ
export type SchedulePeriodType = 'regular' | 'spring' | 'summer' | 'winter';

export const SCHEDULE_PERIOD_LABELS: Record<SchedulePeriodType, string> = {
  regular: '通常期',
  spring: '春期',
  summer: '夏期',
  winter: '冬期',
};

// 曜日
export const DAY_OF_WEEK_LABELS: Record<number, string> = {
  0: '日',
  1: '月',
  2: '火',
  3: '水',
  4: '木',
  5: '金',
  6: '土',
};

// 通塾日程（通常授業パターン）
export interface ScheduleRegularPattern {
  id: string;
  school_id: string;
  student_id: string;
  day_of_week: number;
  time_slot_id: string;
  teacher_id: string;
  subject_ids: string[];
  seat_label: string | null;
  period_type: SchedulePeriodType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // リレーション
  student?: { id: string; last_name: string; first_name: string; grade: number };
  time_slot?: ScheduleTimeSlot;
  teacher?: { id: string; display_name: string | null; email: string | null };
  subjects?: { id: string; name: string }[];
}

export interface ScheduleRegularPatternFormData {
  student_id: string;
  day_of_week: number;
  time_slot_id: string;
  teacher_id: string;
  subject_ids: string[];
  seat_label: string;
  period_type: SchedulePeriodType;
}

// スケジュールエントリ（週次生成された授業）
export type AttendanceStatusType = 'present' | 'absent' | 'late' | null;

export type ScheduleEntryStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'transferred_out'
  | 'transferred_in';

export const SCHEDULE_ENTRY_STATUS_LABELS: Record<ScheduleEntryStatus, string> = {
  scheduled: '予定',
  completed: '出席済',
  cancelled: '取消',
  transferred_out: '振替元',
  transferred_in: '振替先',
};

export interface ScheduleEntry {
  id: string;
  school_id: string;
  entry_date: string;
  time_slot_id: string;
  teacher_id: string;
  student_id: string;
  subject_ids: string[];
  seat_label: string | null;
  note?: string | null;
  regular_pattern_id: string | null;
  attendance_status: AttendanceStatusType;
  attendance_recorded_at?: string | null;
  attendance_recorded_by?: string | null;
  status?: ScheduleEntryStatus;
  transfer_from_id?: string | null;
  transfer_to_id?: string | null;
  created_at: string;
  updated_at: string;
  // リレーション
  student?: { id: string; last_name: string; first_name: string; grade: number };
  time_slot?: ScheduleTimeSlot;
  teacher?: { id: string; display_name: string | null; email: string | null };
  subjects?: { id: string; name: string }[];
}

/** 授業追加・編集フォーム用 */
export interface ScheduleEntryFormData {
  teacher_id: string;
  student_id: string;
  subject_ids: string[];
  seat_label: string;
  note: string;
}

// スケジュール生成結果
export interface ScheduleGenerationResult {
  entries_created: number;
  week_start_date: string;
}

// 時間重複チェック結果
export interface TimeConflictResult {
  type: 'regular_pattern' | 'schedule_entry';
  conflictWith: {
    id: string;
    dayOfWeek?: number;
    date?: string;
    startTime: string;
    endTime: string;
    teacherName: string;
    subjectName: string;
  };
  message: string;
}
