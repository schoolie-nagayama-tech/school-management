export type AlertType =
  | 'score_drop' // 成績低下
  | 'score_missing' // 成績未入力
  | 'interview_overdue' // 面談未更新
  | 'application_overdue' // 申込未提出
  | 'interview_task' // 面談タスク
  | 'exam_overdue' // テスト未更新
  | 'homework_not_done' // 宿題未実施
  | 'tardy' // 遅刻
  | 'course_prep_overdue' // 講習準備未完了
  | 'schedule_change_unapplied' // 週回数/曜日変更の申込が通塾日程に未反映
  | 'interview_recent'; // 面談更新(講師向け)

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  score_drop: '成績低下',
  score_missing: '成績未入力',
  interview_overdue: '面談未更新',
  application_overdue: '申込未提出',
  interview_task: 'タスク',
  exam_overdue: '目標未設定',
  homework_not_done: '宿題未実施',
  tardy: '遅刻',
  course_prep_overdue: '講習準備',
  schedule_change_unapplied: '日程変更未反映',
  interview_recent: '面談更新',
};

/** アラートラベル用：明るいトーンに統一 */
export const ALERT_TYPE_COLORS: Record<AlertType, string> = {
  score_drop: 'bg-red-100 text-red-700',
  score_missing: 'bg-amber-100 text-amber-700',
  interview_overdue: 'bg-orange-100 text-orange-700',
  application_overdue: 'bg-purple-100 text-purple-700',
  interview_task: 'bg-blue-100 text-blue-700',
  exam_overdue: 'bg-rose-100 text-rose-700',
  homework_not_done: 'bg-yellow-100 text-yellow-800',
  tardy: 'bg-orange-100 text-orange-700',
  course_prep_overdue: 'bg-indigo-100 text-indigo-700',
  schedule_change_unapplied: 'bg-teal-100 text-teal-700',
  interview_recent: 'bg-emerald-100 text-emerald-700',
};

/** 段階レベル（バッジの色や強調表現に使用） */
export type AlertSeverity = 'info' | 'warning' | 'danger';

export interface Alert {
  id: string; // 一意なID（student_id + alert_type + alert_key）
  student_id: string;
  student_name: string;
  grade: number;
  school_id?: string;
  alert_type: AlertType;
  alert_key: string;
  message: string; // 表示メッセージ（例: "英語 -12点"）
  details?: {
    subject?: string;
    previous_value?: number;
    current_value?: number;
    diff?: number;
    days_overdue?: number;
    days_until_due?: number;
    item_name?: string;
    due_date?: string;
    task_id?: string;
    interview_date?: string;
    content?: string;
    exam_id?: string;
    exam_date?: string;
    exam_name?: string;
    textbook_name?: string;
    /** score_drop の小区分（定期テスト / 模試 / 通知表）と連続下降回数 */
    score_category?: 'regular_test' | 'mock' | 'report_card';
    consecutive_drops?: number;
    trend?: 'declining_long_term' | null;
    /** 宿題未実施・遅刻の発生回数 */
    occurrence_count?: number;
  };
  /** 段階表示（色だけでなく文言にも使用） */
  severity?: AlertSeverity;
}

export interface AlertDismissal {
  id: string;
  school_id: string;
  student_id: string;
  alert_type: AlertType;
  alert_key: string;
  dismissed_by: string | null;
  dismissed_at: string;
  note: string | null;
  created_at: string;
}

export interface StudentAlerts {
  student_id: string;
  student_name: string;
  grade: number;
  school_id?: string;
  alerts: Alert[];
}

/** アラートのしきい値設定（教室ごと） */
export interface AlertThresholds {
  score_drop_regular?: number; // 定期テスト：N点以上下落で発火（デフォ 10）
  score_drop_mock?: number; // 模試：偏差値 N 以上下落（デフォ 5）
  score_drop_report?: number; // 通知表：N 段階以上下落（デフォ 1）
  interview_overdue_days?: number; // 面談：N日経過（デフォ 30）
  application_warn_days?: number; // 申込：N日前から黄（デフォ 7）
  application_alert_days?: number; // 申込：N日前から橙（デフォ 3）
  exam_overdue_days?: number; // 目標未設定：テスト日からN日経過（デフォ 1）
  homework_warn_count?: number; // 宿題未実施：累積N回で黄（デフォ 1、対応済み後に回数が増えると再表示）
  homework_danger_count?: number; // 宿題未実施：累積N回で赤（デフォ 3、対応済み後に回数が増えると再表示）
  tardy_warn_count?: number; // 遅刻：累積N回で黄（デフォ 1、対応済み後に回数が増えると再表示）
  tardy_danger_count?: number; // 遅刻：累積N回で赤（デフォ 3、対応済み後に回数が増えると再表示）
  trend_window_months?: number; // 長期トレンド判定の月数（デフォ 6）
  course_prep_warn_days?: number; // 講習準備：N日前から黄（デフォ 3）
  course_prep_alert_days?: number; // 講習準備：N日前から橙（デフォ 0 = 当日）
  interview_recent_days?: number; // 面談更新: 記録更新からN日間表示（デフォ 7）。講師のみ表示
}

/**
 * 講師画面でマスクするアラートタイプ（生徒のネガティブ情報）。
 * 講師の画面は生徒にも見えるため、ラベルテキスト・メッセージを非表示にする。
 */
export const SENSITIVE_ALERT_TYPES: ReadonlySet<AlertType> = new Set<AlertType>([
  'score_drop',
  'homework_not_done',
  'tardy',
  'interview_overdue',
]);

/**
 * 講師画面には一切表示しないアラートタイプ。
 * SENSITIVE_ALERT_TYPES が「マスク（伏字で表示）」なのに対し、こちらは行ごと非表示にする。
 * 講習運営（講習準備）・面談運営（面談未更新・面談タスク）は講師の担当業務外のため出さない。
 */
export const TEACHER_HIDDEN_ALERT_TYPES: ReadonlySet<AlertType> = new Set<AlertType>([
  'course_prep_overdue', // 講習準備
  'interview_overdue', // 面談未更新
  'interview_task', // 面談タスク
  'schedule_change_unapplied', // 日程変更未反映（通塾日程の変更は教室長の業務のため講師には出さない）
]);

/**
 * 対応済みボタンで手動 dismiss できるアラートタイプ。
 * これ以外は実績入力（面談記録・成績入力など）で自動的に消える。
 */
export const DISMISSABLE_ALERT_TYPES: ReadonlySet<AlertType> = new Set<AlertType>([
  'score_drop',
  'homework_not_done',
  'tardy',
  // 通塾日程を実際に変更すれば自動で消えるが、「変更不要（申込却下等）」のケースのために
  // 手動で対応済みにもできるようにする。
  'schedule_change_unapplied',
]);

/**
 * 講師画面にのみ表示するアラートタイプ。
 * 面談更新は「面談に同席しない講師が新しい面談情報に気づく」ための通知で、
 * 面談を記録する側の教室長以上には不要なノイズになるため出さない。
 */
export const TEACHER_ONLY_ALERT_TYPES: ReadonlySet<AlertType> = new Set<AlertType>([
  'interview_recent',
]);

export const DEFAULT_ALERT_THRESHOLDS: Required<AlertThresholds> = {
  score_drop_regular: 10,
  score_drop_mock: 5,
  score_drop_report: 1,
  interview_overdue_days: 30,
  application_warn_days: 7,
  application_alert_days: 3,
  exam_overdue_days: 1,
  homework_warn_count: 1,
  homework_danger_count: 3,
  tardy_warn_count: 1,
  tardy_danger_count: 3,
  trend_window_months: 6,
  course_prep_warn_days: 3,
  course_prep_alert_days: 0,
  interview_recent_days: 7,
};

export interface AlertSetting {
  school_id: string;
  alert_type: AlertType;
  enabled: boolean;
  thresholds: AlertThresholds;
}
