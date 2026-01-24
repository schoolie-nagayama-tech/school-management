export type AlertType = 
  | 'score_drop'        // 成績低下
  | 'score_missing'     // 成績未入力
  | 'interview_overdue' // 面談未更新
  | 'application_overdue' // 申込未提出
  | 'interview_task'    // 面談タスク
  | 'exam_overdue';     // テスト未更新

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  score_drop: '成績低下',
  score_missing: '成績未入力',
  interview_overdue: '面談未更新',
  application_overdue: '申込未提出',
  interview_task: 'タスク',
  exam_overdue: '目標未設定',
};

export const ALERT_TYPE_COLORS: Record<AlertType, string> = {
  score_drop: 'bg-red-100 text-red-800 border border-red-300',
  score_missing: 'bg-yellow-100 text-yellow-800 border border-yellow-300',
  interview_overdue: 'bg-orange-100 text-orange-800 border border-orange-300',
  application_overdue: 'bg-purple-100 text-purple-800 border border-purple-300',
  interview_task: 'bg-blue-100 text-blue-800 border border-blue-300',
  exam_overdue: 'bg-pink-100 text-pink-800 border border-pink-300',
};

export interface Alert {
  id: string;  // 一意なID（student_id + alert_type + alert_key）
  student_id: string;
  student_name: string;
  grade: number;
  alert_type: AlertType;
  alert_key: string;
  message: string;  // 表示メッセージ（例: "英語 -12点"）
  details?: {
    subject?: string;
    previous_value?: number;
    current_value?: number;
    diff?: number;
    days_overdue?: number;
    item_name?: string;
    due_date?: string;
  };
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
  alerts: Alert[];
}
