/**
 * 講習 自動コマ割り — 入出力型（DB非依存の純粋データ）
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md
 *
 * この層は Supabase を一切参照しない。DBからの読み出し（申込・可能表・シフト・容量）は
 * 呼び出し側で行い、ここには「素のデータ」を渡す。こうすることで
 *  - 合成データで単体テストできる（src/__tests__/lib/koushuAllocator.test.ts）
 *  - ブラウザ上のシミュレータで設定を変えながら結果を目視できる
 *  - 本番配線時はアダプタを書くだけでロジックを再利用できる
 */

import type { HalfPosition } from '@/lib/utils/seatOccupancy';

/** セルキー: `${date}_${slotId}` */
export type CellKey = string;

/** 個別コマの定義（schedule_time_slots の必要分だけ） */
export interface SlotDef {
  id: string;
  slot_number: number;
  /** "HH:MM" or "HH:MM:SS" */
  start_time: string;
  end_time: string;
}

export interface TeacherDef {
  id: string;
  name: string;
  gender?: 'male' | 'female' | 'other' | null;
  /** 空/未指定 = 全科目可（既存慣習） */
  teachableSubjectIds?: string[] | null;
}

export interface StudentDef {
  id: string;
  name: string;
  grade: number;
  fixedTeacherIds?: string[];
  excludedTeacherIds?: string[];
  preferredTeacherGender?: 'male' | 'female' | null;
}

export interface SubjectDef {
  id: string;
  name: string;
}

/**
 * 申込1件分のタスク（生徒×科目）。
 * koma は「コマ数」。45分1コマも1と数える（仕様書 §3-1 の単位定義）。
 */
export interface TaskDef {
  studentId: string;
  subjectId: string;
  /** 残りコマ数（既存の公開済み配置を差し引いた後の値を渡す） */
  koma: number;
  /** 1=1対1 / 2=1対2。申込時に科目ごと指定 */
  ratio: 1 | 2;
  /** 45 or 90。45 のとき半コマ（前半/後半）で配置される */
  duration: 45 | 90;
}

/** 既存配置（公開済み・手動配置・差分モード時の下書き） */
export interface ExistingPlacement {
  studentId: string;
  subjectId: string;
  date: string;
  slotId: string;
  teacherId: string;
  ratio: 1 | 2;
  duration: 45 | 90;
  halfPosition: HalfPosition;
}

export interface AllocatorSettings {
  /** 生徒1人の1日あたり講習コマ上限（コマ数） */
  maxKomaPerStudentPerDay: number;
  /** 同日に2コマ入れるなら連続コマを優先 */
  preferConsecutive: boolean;
  /** 同一科目を同じ日に2コマ入れてよいか */
  allowSameSubjectSameDay: boolean;
  /**
   * 同一科目のコマ数を期間全体に等間隔で散らす。
   * ON のとき「隣のコマとの間隔」だけでなく「期間全体のどこに来るべきか（絶対位置）」も
   * 見る。前半に英語が固まり後半が数学だけになるのを防ぐのはこの絶対位置の方。
   */
  spreadSubjectEvenly: boolean;
}

export const DEFAULT_SETTINGS: AllocatorSettings = {
  maxKomaPerStudentPerDay: 2,
  preferConsecutive: true,
  allowSameSubjectSameDay: false,
  spreadSubjectEvenly: true,
};

export interface CapacityDef {
  /** 1講師あたりの個別席数（school_class_capacity.max_students_per_teacher_individual） */
  maxStudentsPerTeacher: number;
  /** 教室全体の個別席数（school_class_capacity.total_individual_seats） */
  totalIndividualSeats: number;
}

export interface AllocatorInput {
  /** 期間の稼働日（休講日は呼び出し側で除外して渡す） YYYY-MM-DD 昇順 */
  dates: string[];
  /** 個別コマ（slot_number 昇順） */
  slots: SlotDef[];
  students: StudentDef[];
  teachers: TeacherDef[];
  subjects: SubjectDef[];
  tasks: TaskDef[];
  /** 生徒の出席可能枠。値は CellKey の集合。**エントリが無い生徒＝可能表未提出** */
  studentAvailability: Map<string, Set<CellKey>>;
  /** セルごとの出勤可能講師ID。講習シフト提出が正典（未提出講師は含めない） */
  teacherAvailability: Map<CellKey, string[]>;
  capacity: CapacityDef;
  existing: ExistingPlacement[];
  settings: AllocatorSettings;
  /** 過去担当（内部スコアの +pastHistory 用）。省略可 */
  pastTeacherByStudent?: Map<string, Set<string>>;
}

export interface Assignment {
  studentId: string;
  subjectId: string;
  date: string;
  slotId: string;
  teacherId: string;
  ratio: 1 | 2;
  duration: 45 | 90;
  halfPosition: HalfPosition;
  /** 内部スコア（UIには出さない。デバッグ/シミュレータ用） */
  score: number;
}

/** 未割当の理由分類（仕様書 §5-3） */
export type UnassignedReason =
  | 'no_availability_submission' // 可能表未提出
  | 'not_enough_available_cells' // 生徒の可能枠自体が足りない
  | 'no_teacher' // 枠はあるが置ける講師がいない
  | 'no_seat' // 教室が満席
  | 'daily_limit'; // 1日上限・同日同科目制約で入らない

export const UNASSIGNED_REASON_LABELS: Record<UnassignedReason, string> = {
  no_availability_submission: '可能表未提出',
  not_enough_available_cells: '可能枠不足',
  no_teacher: '講師不足',
  no_seat: '席不足',
  daily_limit: '上限到達',
};

export interface UnassignedTask {
  studentId: string;
  subjectId: string;
  /** 割り当てられなかったコマ数 */
  koma: number;
  reason: UnassignedReason;
}

/** 期間を等分した1区間の科目構成 */
export interface SubjectBalanceQuarter {
  startDate: string;
  endDate: string;
  /** 科目ID → その期に置かれたコマ数 */
  komaBySubject: Record<string, number>;
  total: number;
}

/** 科目が期間全体へ均等に散っているかの計測結果（computeSubjectBalance が算出） */
export interface SubjectBalance {
  /** 0〜1。1に近いほど各科目が期間全体へ均等に散っている */
  evenness: number;
  /** 期別の科目構成（前半/後半の偏りを目で見る用） */
  quarters: SubjectBalanceQuarter[];
  /** 偏りが大きい生徒×科目（上位10件）。drift は 0=均等 / 0.5=片端に全部 */
  worst: Array<{ studentId: string; subjectId: string; drift: number }>;
}

export interface AllocatorResult {
  assignments: Assignment[];
  unassigned: UnassignedTask[];
  stats: {
    requestedKoma: number;
    assignedKoma: number;
    /** 講師ID → 割当コマ数（負荷の偏りを見る） */
    loadByTeacher: Record<string, number>;
    /** リペアで救済できたコマ数 */
    repairedKoma: number;
    /** 科目の時間的な偏り（前半英語ばかり…を検知する） */
    subjectBalance: SubjectBalance;
  };
}
