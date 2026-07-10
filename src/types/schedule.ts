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
  /** Phase R: 指導比率。1=1対1（生徒1名で満席） / 2=1対2（既定）。生徒×科目契約由来。 */
  ratio: 1 | 2;
  /** Phase R: 授業時間(分)。45 or 90。NULL=全コマ(90分)扱い。subjects.duration_minutes のスナップショット。 */
  duration_minutes: number | null;
  /** Phase R: 45分授業の占有半コマ。'first'=前半 / 'second'=後半 / NULL=全コマ。 */
  half_position: HalfPosition;
  created_at: string;
  updated_at: string;
  // リレーション
  student?: {
    id: string;
    last_name: string;
    first_name: string;
    grade: number;
    /** 講師希望性別（D&D制約に使用） */
    preferred_teacher_gender?: 'male' | 'female' | null;
    /** 担当固定講師（D&D時の優先判定に使用） */
    fixed_teacher_ids?: string[] | null;
    /** 担当除外講師（D&Dブロック対象） */
    excluded_teacher_ids?: string[] | null;
  };
  time_slot?: ScheduleTimeSlot;
  teacher?: {
    id: string;
    display_name: string | null;
    /** 姓（座席表ボードは密度優先で姓のみ表示） */
    last_name?: string | null;
    email: string | null;
  } | null;
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
  /** Phase R: 指導比率。省略時は 2（1対2）。 */
  ratio?: 1 | 2;
  /** Phase R: 授業時間(分)。45 or 90。省略/NULL=全コマ扱い。 */
  duration_minutes?: number | null;
  /** Phase R: 45分授業の占有半コマ。省略/NULL=全コマ。 */
  half_position?: HalfPosition;
}

/** Phase R: 45分授業の占有半コマ位置。null=全コマ。seatOccupancy と共有する型。 */
export type HalfPosition = 'first' | 'second' | null;

// スケジュールエントリ（週次生成された授業）
export type AttendanceStatusType = 'present' | 'absent' | 'late' | null;

/**
 * 授業種別
 * - regular  : 通常授業（通塾日程から自動生成）
 * - koushu   : 講習（春期・夏期・冬期講座。通塾日程と独立）
 * - test_prep: テスト対策（追加授業の一種。単発で手動配置）
 * - additional: 追加授業（単発で手動配置）
 * - trial    : 体験授業（単発で手動配置）
 *
 * test_prep / additional / trial は「追加授業」としてまとめて扱う単発コマ。
 * 通塾日程を持たず（regular_pattern_id=NULL）、座席表の空きセルから手動配置する。
 * 週次再生成では削除されない（regular のみ再生成対象のため保護される）。
 */
export type ScheduleEntryKind = 'regular' | 'koushu' | 'test_prep' | 'additional' | 'trial';

export const SCHEDULE_ENTRY_KIND_LABELS: Record<ScheduleEntryKind, string> = {
  regular: '通常',
  koushu: '講習',
  test_prep: 'テスト対策',
  additional: '追加授業',
  trial: '体験',
};

/**
 * 「追加授業」としてまとめて扱う単発コマの種別（regular/koushu 以外）。
 * 室長が座席表の空きセルから手動で配置する単発授業。
 */
export const EXTRA_LESSON_KINDS = ['test_prep', 'additional', 'trial'] as const;
export type ExtraLessonKind = (typeof EXTRA_LESSON_KINDS)[number];

/** 追加授業（単発コマ）かどうか。表示の出し分けや保護判定に使う。 */
export function isExtraLessonKind(kind: ScheduleEntryKind): kind is ExtraLessonKind {
  return (EXTRA_LESSON_KINDS as readonly string[]).includes(kind);
}

/**
 * 授業形態。
 *
 * Phase A（指導形態の動的マスタ化）で union から string へ緩めた。
 * 形態は schedule_formations テーブルで自由に作成・削除できるため、
 * コンパイル時に値を固定できない（'individual'/'group' 以外に 'f_xxxxxxxx' 等が入る）。
 * タイポ検出の代わりに、以下の定数を直書きの代替として使い、DB側は FK で正当性を守る。
 *
 * - individual: 個別指導（1講師あたり生徒数名、ブース運用）。is_system。座席表メイングリッド。
 * - group     : 集団指導（1講師あたり多人数）。is_system。講習の集団レーンが依存。
 *
 * 重要：形態ごとにコマ時間自体が違うため、同じセルに混在しない。
 * ただし時間帯が重なる場合があり（個別19:30-21:00 と 集団20:20-21:20 等）、
 * 同一生徒・同一講師は同時刻の重複コマには入れない（排他制約）。
 */
export type ScheduleEntryFormation = string;

/**
 * 直書き禁止のための形態キー定数。
 * ScheduleEntryFormation を string に緩めたことで失われたタイポ検出を、
 * この2定数を参照させることで最小限に補う（新規のユーザー定義形態は DB マスタ側で管理）。
 */
export const INDIVIDUAL_FORMATION = 'individual';
export const GROUP_FORMATION = 'group';

export const SCHEDULE_ENTRY_FORMATION_LABELS: Record<string, string> = {
  individual: '個別',
  group: '集団',
};

/**
 * 形態のレーン型（描画・講師重複ポリシーの型）。
 * - individual: 1講師1-2名の座席グリッド型
 * - group     : 1講師N名のカードレーン型（小集団/プログラミング等はこちら）
 */
export type FormationLaneType = 'individual' | 'group';

/** 指導形態マスタ（schedule_formations テーブル）。Phase A で新設した動的マスタ。 */
export interface ScheduleFormation {
  /** 主キー。'individual'/'group'（is_system）またはユーザー定義の自動生成キー 'f_xxxxxxxx'。 */
  key: string;
  /** 表示名。個別 / 集団 / 小集団 / プログラミング… */
  label: string;
  /** レーン型。描画方式と講師重複ポリシーの分岐に使う。 */
  lane_type: FormationLaneType;
  /** individual/group は true（削除・改名不可）。 */
  is_system: boolean;
  /** false でタブ非表示（ソフト削除）。 */
  is_active: boolean;
  /** タブ・一覧の並び順。 */
  sort_order: number;
  created_at: string;
}

/** 形態別の定員設定（school_formation_capacity テーブル）。Phase A で新設。 */
export interface SchoolFormationCapacity {
  id: string;
  school_id: string;
  formation: string;
  /** 1枠あたり生徒数上限（デフォルト8） */
  max_students_per_group: number;
  /** 同時刻の枠数上限（デフォルト1） */
  max_concurrent_groups: number;
  created_at: string;
  updated_at: string;
}

/** 形態作成・更新フォーム用（ユーザーが触るのは label のみ） */
export interface ScheduleFormationFormData {
  label: string;
}

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
  /** Phase R: 指導比率。1=1対1 / 2=1対2（既定）。パターンからスナップショット継承。 */
  ratio: 1 | 2;
  /** Phase R: 授業時間(分)。45 or 90。NULL=全コマ扱い。 */
  duration_minutes: number | null;
  /** Phase R: 45分授業の占有半コマ。'first' / 'second' / NULL=全コマ。 */
  half_position: HalfPosition;
  // 注意: 上の teacher_id は型上 string になっているが、
  // 「担当未決定」エントリでは NULL になる場合がある。
  // 既存呼び出し側との互換のため string 表記のまま運用し、null チェックを使用側で行う。
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
  student?: {
    id: string;
    last_name: string;
    first_name: string;
    grade: number;
    /** 講師希望性別（D&D制約に使用） */
    preferred_teacher_gender?: 'male' | 'female' | null;
    /** 担当固定講師（D&D時の優先判定に使用） */
    fixed_teacher_ids?: string[] | null;
    /** 担当除外講師（D&Dブロック対象） */
    excluded_teacher_ids?: string[] | null;
  };
  time_slot?: ScheduleTimeSlot;
  teacher?: {
    id: string;
    display_name: string | null;
    /** 姓（座席表ボードは密度優先で姓のみ表示） */
    last_name?: string | null;
    email: string | null;
  };
  subjects?: { id: string; name: string }[];
  /** マッチング下書き提案を座席表に重ねるための擬似エントリ印（実DBエントリではない） */
  isDraft?: boolean;
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
  /** Phase R: 指導比率。省略時は 2（1対2）。 */
  ratio?: 1 | 2;
  /** Phase R: 授業時間(分)。45 or 90。省略/NULL=全コマ扱い。 */
  duration_minutes?: number | null;
  /** Phase R: 45分授業の占有半コマ。省略/NULL=全コマ。 */
  half_position?: HalfPosition;
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
