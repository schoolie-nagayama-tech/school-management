/**
 * 授業報告書 (class_reports) の型定義
 *
 * 1コマ × 1生徒 = 1レコード。
 * schedule_entry_id でスケジュールと紐付き、ワークフローで「下書き→提出→承認→公開」を管理。
 */

/** ワークフロー状態 */
export type ClassReportStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export const CLASS_REPORT_STATUS_LABELS: Record<ClassReportStatus, string> = {
  draft: '下書き',
  submitted: '承認待ち',
  approved: '公開済み',
  rejected: '差し戻し',
};

/** 次回までの宿題 1行 */
export interface HomeworkAssignmentItem {
  /** 日割りの目安日付 'YYYY-MM-DD'。空文字は日付指定なし */
  date: string;
  /** 宿題の内容 */
  text: string;
}

/**
 * 科目別欄の中身（科目によって kind と内容が変わる）
 *
 * `extra_materials` は Stage4 で追加した「プリント等・テキスト外教材の自由記述」。
 * class_reports に専用の列が無く、マイグレーションを増やさない方針のため、
 * jsonb 列 `subject_specific` に同居させている（kind に依らず常に持てる）。
 */
export type SubjectSpecific =
  | {
      kind: 'vocab'; // 英語の単語練習
      range: string; // 例: 'Unit 6 単語'
      pages: string; // 例: '46-49'
      times_per_day: number; // 1日の練習回数
      duration: string; // 期間（例：'1週間'）
      extra_materials?: string;
    }
  | {
      kind: 'calc'; // 数学の計算練習
      range: string;
      pages: string;
      times_per_day: number;
      duration: string;
      extra_materials?: string;
    }
  | {
      kind: 'kanji'; // 国語の漢字練習
      range: string;
      pages: string;
      times_per_day: number;
      duration: string;
      extra_materials?: string;
    }
  | { kind: 'none'; extra_materials?: string };

/** メインテーブル class_reports の行 */
export interface ClassReport {
  id: string;
  school_id: string;
  schedule_entry_id: string;
  student_id: string;
  teacher_id: string;
  lesson_date: string;

  // 目標
  short_term_goal: string | null;
  mid_term_goal_snapshot: string | null;
  mid_action_goal_snapshot: string | null;

  // 進度
  school_progress: string | null;

  // 宿題・テスト
  homework_completion_pct: number | null;
  homework_correct_pct: number | null;
  today_correct_pct: number | null;
  vocab_test_score: number | null;
  vocab_test_total: number | null;
  vocab_test_passed: boolean | null;
  check_test_score: number | null;
  check_test_total: number | null;
  check_test_passed: boolean | null;

  // 講評・宿題
  review_comment: string | null;
  homework_assignments: HomeworkAssignmentItem[];

  // 科目別
  subject_specific: SubjectSpecific | null;

  // ワークフロー
  status: ClassReportStatus;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;

  created_at: string;
  updated_at: string;

  // リレーション（join 結果）
  student?: { id: string; last_name: string; first_name: string; grade: number };
  teacher?: { id: string; display_name: string | null; email: string | null };
  units?: LessonReportUnit[];
}

/** 子テーブル lesson_report_units の行（単元×教材セット） */
export interface LessonReportUnit {
  id: string;
  report_id: string;
  student_textbook_id: string;
  is_main: boolean;
  curriculum_item_ids: number[];
  page_start: number | null;
  page_end: number | null;
  display_order: number;
  created_at: string;
  updated_at: string;
  // リレーション
  student_textbook?: {
    id: string;
    textbook_id: number;
    textbook?: { id: number; name: string };
  };
}

/** 報告書フォーム用：フロントから API に渡す入力データ */
export interface ClassReportFormData {
  schedule_entry_id: string;
  student_id: string;
  teacher_id: string;
  lesson_date: string;

  short_term_goal: string;
  mid_term_goal_snapshot: string;
  mid_action_goal_snapshot: string;
  school_progress: string;
  homework_completion_pct: number | null;
  homework_correct_pct: number | null;
  today_correct_pct: number | null;
  vocab_test_score: number | null;
  vocab_test_total: number | null;
  vocab_test_passed: boolean | null;
  check_test_score: number | null;
  check_test_total: number | null;
  check_test_passed: boolean | null;
  review_comment: string;
  homework_assignments: HomeworkAssignmentItem[];
  subject_specific: SubjectSpecific | null;
  status: ClassReportStatus;

  /** 単元×教材セット（メイン1 + サブN）。保存時にまとめて upsert */
  units: Array<{
    id?: string; // 既存更新ならID、新規なら未指定
    student_textbook_id: string;
    is_main: boolean;
    curriculum_item_ids: number[];
    page_start: number | null;
    page_end: number | null;
    display_order: number;
  }>;
}
