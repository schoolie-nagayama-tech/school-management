import type { Alert, AlertType, AlertSeverity, StudentAlerts } from '@/types/alerts';
import { ALERT_TYPE_LABELS } from '@/types/alerts';

/**
 * アラートの系列（種類）別再構成ロジック。
 *
 * AlertBoard は従来「生徒ごとのカード」で表示していたが、系列（alert_type）ごとの
 * セクションに再編し、同一生徒×同一系列の複数アラートを1行に集約する。
 * ここは表示に依存しない純関数として切り出し、ユニットテストで固定する
 * （請求同期ロジックと同じ方針）。
 */

/** severity の重み（並び替え・最大値算出に使用） */
export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  danger: 3,
  warning: 2,
  info: 1,
};

/**
 * アラートの severity を解決する。
 *
 * ビルダーが severity を設定していればそれを優先する。未設定のタイプ
 * （score_missing / interview_overdue / interview_task / exam_overdue）には、
 * details の経過日数・期日に基づく既定の段階を与え、「情報の重さ」を必ず持たせる。
 * 表示の強調とセクション/行の並び替えの両方で、この解決済み severity を使う。
 */
export function resolveSeverity(alert: Alert): AlertSeverity {
  if (alert.severity) return alert.severity;

  const d = alert.details ?? {};
  switch (alert.alert_type) {
    case 'interview_overdue': {
      // 面談記録なし(Infinity)や長期未実施(60日以上)は danger、それ以外は warning
      const days = d.days_overdue ?? 0;
      return !Number.isFinite(days) || days >= 60 ? 'danger' : 'warning';
    }
    case 'exam_overdue': {
      // テスト日から7日以上過ぎて目標未設定は danger
      const days = d.days_overdue ?? 0;
      return days >= 7 ? 'danger' : 'warning';
    }
    case 'interview_task': {
      // 期日超過は danger、間近(2日以内)は warning、先の予定は info
      const due = d.days_until_due;
      if (due === undefined || due === null) return 'warning';
      if (due < 0) return 'danger';
      if (due <= 2) return 'warning';
      return 'info';
    }
    case 'score_missing':
      return 'warning';
    default: {
      // その他の未設定タイプ: 期日ベースのフォールバック（AlertItem のスタイル分岐と整合）
      const due = d.days_until_due;
      if (due === undefined || due === null) return 'info';
      if (due >= 2) return 'info';
      if (due >= 0) return 'warning';
      return 'danger';
    }
  }
}

/** 系列セクション内の1行（生徒×系列で集約済み） */
export interface AlertSeriesRow {
  student_id: string;
  student_name: string;
  grade: number;
  school_id?: string;
  /** この生徒×系列に属する個別アラートの最大 severity */
  severity: AlertSeverity;
  /** 個別アラート（展開表示・対応済み操作に使う）。集約元の順序を保持 */
  alerts: Alert[];
}

/** 系列（alert_type）ごとのセクション */
export interface AlertSeriesSection {
  alert_type: AlertType;
  label: string;
  /** セクション内の最大 severity（見出し色・並び替えに使用） */
  severity: AlertSeverity;
  /** 行数（＝この系列に該当する生徒数） */
  studentCount: number;
  /** 個別アラート総数 */
  alertCount: number;
  rows: AlertSeriesRow[];
}

function maxSeverity(list: AlertSeverity[]): AlertSeverity {
  return list.reduce<AlertSeverity>(
    (acc, s) => (SEVERITY_RANK[s] > SEVERITY_RANK[acc] ? s : acc),
    'info'
  );
}

/**
 * StudentAlerts[]（生徒ごと）を系列（alert_type）ごとのセクションに再編する。
 * - 同一生徒×同一系列の複数アラートは1行（AlertSeriesRow）に集約。
 * - 行はセクション内で severity の高い順 → 氏名順。
 * - セクションは severity の高い順 → 生徒数の多い順 → ラベル順（danger を含む系列が上）。
 */
export function groupAlertsBySeries(students: StudentAlerts[]): AlertSeriesSection[] {
  // alert_type -> student_id -> 集約行
  const byType = new Map<AlertType, Map<string, AlertSeriesRow>>();

  for (const sa of students) {
    for (const alert of sa.alerts) {
      let byStudent = byType.get(alert.alert_type);
      if (!byStudent) {
        byStudent = new Map();
        byType.set(alert.alert_type, byStudent);
      }
      let row = byStudent.get(sa.student_id);
      if (!row) {
        row = {
          student_id: sa.student_id,
          student_name: sa.student_name,
          grade: sa.grade,
          school_id: sa.school_id ?? alert.school_id,
          severity: 'info',
          alerts: [],
        };
        byStudent.set(sa.student_id, row);
      }
      row.alerts.push(alert);
    }
  }

  const sections: AlertSeriesSection[] = [];
  for (const [alertType, byStudent] of Array.from(byType.entries())) {
    const rows = Array.from(byStudent.values());
    let alertCount = 0;
    for (const row of rows) {
      row.severity = maxSeverity(row.alerts.map(resolveSeverity));
      alertCount += row.alerts.length;
    }
    rows.sort((a, b) => {
      const d = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (d !== 0) return d;
      return a.student_name.localeCompare(b.student_name, 'ja');
    });
    sections.push({
      alert_type: alertType,
      label: ALERT_TYPE_LABELS[alertType],
      severity: maxSeverity(rows.map((r) => r.severity)),
      studentCount: rows.length,
      alertCount,
      rows,
    });
  }

  sections.sort((a, b) => {
    const d = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (d !== 0) return d;
    const c = b.studentCount - a.studentCount;
    if (c !== 0) return c;
    return a.label.localeCompare(b.label, 'ja');
  });

  return sections;
}

/** 生徒カード内の1行（同一生徒×同一系列で集約済み） */
export interface StudentSeriesRow {
  alert_type: AlertType;
  label: string;
  /** この系列の最大 severity */
  severity: AlertSeverity;
  /** 同系列の個別アラート（1件ならそのまま、複数なら展開表示に使う） */
  alerts: Alert[];
}

/** 生徒（人）ごとのアラートグループ */
export interface StudentAlertGroup {
  student_id: string;
  student_name: string;
  grade: number;
  school_id?: string;
  /** この生徒の最大 severity（カードの並び替え・見出し色に使用） */
  severity: AlertSeverity;
  /** 系列ごとに集約した行（severity の高い順） */
  rows: StudentSeriesRow[];
}

/**
 * StudentAlerts[] を「人（生徒）ごと」にまとめ、各生徒内で同一系列（alert_type）を
 * 1行に集約する。トップレベルの並びは生徒単位（severity 高い順 → 行数多い順 → 氏名順）。
 *
 * 「アラートは人ごとにまとめる／同系統は1行」という運用方針に合わせた集約。
 * 系列を横断したセクション表示ではなく、生徒カードの中に系列行を並べる。
 */
export function groupByStudentThenSeries(students: StudentAlerts[]): StudentAlertGroup[] {
  const groups: StudentAlertGroup[] = [];

  for (const sa of students) {
    // alert_type -> 同系列のアラート配列
    const byType = new Map<AlertType, Alert[]>();
    for (const alert of sa.alerts) {
      const list = byType.get(alert.alert_type);
      if (list) list.push(alert);
      else byType.set(alert.alert_type, [alert]);
    }

    const rows: StudentSeriesRow[] = Array.from(byType.entries()).map(([alertType, alerts]) => ({
      alert_type: alertType,
      label: ALERT_TYPE_LABELS[alertType],
      severity: maxSeverity(alerts.map(resolveSeverity)),
      alerts,
    }));
    // 行: severity 高い順 → ラベル順
    rows.sort((a, b) => {
      const d = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (d !== 0) return d;
      return a.label.localeCompare(b.label, 'ja');
    });

    if (rows.length === 0) continue;

    groups.push({
      student_id: sa.student_id,
      student_name: sa.student_name,
      grade: sa.grade,
      school_id: sa.school_id,
      severity: maxSeverity(rows.map((r) => r.severity)),
      rows,
    });
  }

  // 生徒: severity 高い順 → 行数（系列数）多い順 → 氏名順
  groups.sort((a, b) => {
    const d = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (d !== 0) return d;
    const c = b.rows.length - a.rows.length;
    if (c !== 0) return c;
    return a.student_name.localeCompare(b.student_name, 'ja');
  });

  return groups;
}
