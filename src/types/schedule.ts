// コマ時間マスタ
//   formation で個別用 / 集団用を分けて管理する。slot_number は (school_id, formation) ごとに連番。
export interface ScheduleTimeSlot {
  id: string;
  school_id: string;
  slot_number: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  display_order: number;
  /**
   * コマ時間の対象形態。
   * 個別と集団でコマ時間自体が違うため、それぞれ独立した時間枠として登録する。
   * 例：個別1限 13:00-14:20 / 集団1限 14:00-15:30
   */
  formation: ScheduleEntryFormation;
  created_at: string;
  updated_at: string;
}

export interface ScheduleTimeSlotFormData {
  slot_number: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  display_order: number;
  formation?: ScheduleEntryFormation;
}

// 学校別の授業生徒数上限設定（school_class_capacity テーブル）
export interface SchoolClassCapacity {
  id: string;
  school_id: string;
  /** 個別: 1講師あたりの生徒上限（デフォルト2 = 1対2まで） */
  max_students_per_teacher_individual: number;
  /** 個別: 教室全体の同時席数（デフォルト12） */
  total_individual_seats: number;
  /** 集団: 1コマあたりの生徒上限（デフォルト8） */
  max_students_per_group: number;
  /** 集団: 同時に開催できる集団コマ数（デフォルト1 = 1室のみ） */
  max_concurrent_groups: number;
  created_at: string;
  updated_at: string;
}

export interface SchoolClassCapacityFormData {
  max_students_per_teacher_individual: number;
  total_individual_seats: number;
  max_students_per_group: number;
  max_concurrent_groups: number;
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
  teacher_id: string | null;
  subject_ids: string[];
  seat_label: string | null;
  period_type: SchedulePeriodType;
  is_active: boolean;
  /** 有効開始日 'YYYY-MM-DD'。この日以降のスケジュール生成・5週目計算で参照される */
  effective_from: string;
  /** 有効終了日 'YYYY-MM-DD' or null。NULL は無期限。退塾や曜日変更時に旧行へセット */
  effective_until: string | null;
  /**
   * 授業形態。通常はパターン作成時に指定し、スケジュール自動生成で schedule_entries.formation に引き継がれる。
   * 1人の生徒が個別パターンと集団パターンの両方を持つこともあるため、行ごとに違って良い。
   */
  formation: ScheduleEntryFormation;
  created_at: string;
  updated_at: string;
  // リレーション
  student?: { id: string; last_name: string; first_name: string; grade: number };
  time_slot?: ScheduleTimeSlot;
  teacher?: { id: string; display_name: string | null; email: string | null } | null;
  subjects?: { id: string; name: string }[];
}

export interface ScheduleRegularPatternFormData {
  student_id: string;
  day_of_week: number;
  time_slot_id: string;
  teacher_id: string | null;
  subject_ids: string[];
  seat_label: string;
  period_type: SchedulePeriodType;
  /** 適用開始日。未指定なら今日 */
  effective_from?: string;
  /** 適用終了日。未指定なら無期限 */
  effective_until?: string | null;
  /** 授業形態。省略時は 'individual' */
  formation?: ScheduleEntryFormation;
}

// スケジュールエントリ（週次生成された授業）
export type AttendanceStatusType = 'present' | 'absent' | 'late' | null;

/**
 * 授業種別
 * - regular: 通常授業（通塾日程から自動生成）
 * - koushu : 講習（春期・夏期・冬期講座。通塾日程と独立）
 */
export type ScheduleEntryKind = 'regular' | 'koushu';

export const SCHEDULE_ENTRY_KIND_LABELS: Record<ScheduleEntryKind, string> = {
  regular: '通常',
  koushu: '講習',
};

/**
 * 授業形態
 * - individual: 個別指導（1講師あたり生徒数名、ブース運用）
 * - group     : 集団指導（1講師あたり多人数、教室まるごと）
 *
 * 重要：個別と集団はコマ時間自体が違うため、同じセルに混在しない。
 * ただし時間帯が重なる場合があり（個別19:30-21:00 と 集団20:20-21:20 等）、
 * 同一生徒・同一講師は同時刻の重複コマには入れない（排他制約）。
 */
export type ScheduleEntryFormation = 'individual' | 'group';

export const SCHEDULE_ENTRY_FORMATION_LABELS: Record<ScheduleEntryFormation, string> = {
  individual: '個別',
  group: '集団',
};

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
  /** 授業種別（通常 / 講習） */
  kind: ScheduleEntryKind;
  /** 授業形態（個別 / 集団） */
  formation: ScheduleEntryFormation;
  attendance_status: AttendanceStatusType;
  attendance_recorded_at?: string | null;
  attendance_recorded_by?: string | null;
  status?: ScheduleEntryStatus;
  transfer_from_id?: string | null;
  transfer_to_id?: string | null;
  /**
   * 振替期限 'YYYY-MM-DD'。transferred_out のエントリで設定される。
   * 元授業日の翌月末日（例：2026-05-15 欠席 → 2026-06-30）。
   * transfer_to_id がセットされていれば実質期限消化済み。
   */
  transfer_deadline?: string | null;
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
  /**
   * 授業種別。省略時は 'regular'。
   * 通塾日程から自動生成するときは 'regular'、講習コマを手動配置するときは 'koushu' を指定。
   */
  kind?: ScheduleEntryKind;
  /**
   * 授業形態。省略時は 'individual'。
   * 集団指導コマは 'group' を指定（コマ時間マスタも別建てになる）。
   */
  formation?: ScheduleEntryFormation;
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
