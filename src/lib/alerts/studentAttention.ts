import type { Alert, AlertType, StudentAlerts } from '@/types/alerts';
import { TEACHER_HIDDEN_ALERT_TYPES, TEACHER_ONLY_ALERT_TYPES } from '@/types/alerts';
import { groupByStudentThenSeries } from './grouping';

/**
 * ロールで表示から外すアラート種別。生徒一覧のアラート欄（AlertBoard）と生徒ハブで共有する。
 *
 * - 講師: 講習準備・面談運営など担当外の種別を行ごと出さない（TEACHER_HIDDEN_ALERT_TYPES）。
 * - 講師以外（教室長以上）: 講師向けの「面談更新」を出さない（TEACHER_ONLY_ALERT_TYPES）。
 *
 * ★ここを画面ごとに書き分けると、一覧とハブで出るアラートがずれる。絞り方を変えるならここだけ直す。
 */
export function alertTypesHiddenForRole(isTeacher: boolean): ReadonlySet<AlertType> {
  return isTeacher ? TEACHER_HIDDEN_ALERT_TYPES : TEACHER_ONLY_ALERT_TYPES;
}

/**
 * 生徒ハブの「注意すること」でだけ外す種別（ロールの絞り込みとは別にかける）。
 *
 * - interview_recent（面談更新）: 講師向けの良い知らせで、注意ではない。
 * - interview_task（未完了タスク）: 同じ「気にすること」に「未完了の約束」の一覧があり、二重になる。
 */
export const HUB_EXCLUDED_ALERT_TYPES: ReadonlySet<AlertType> = new Set<AlertType>([
  'interview_recent',
  'interview_task',
]);

/**
 * 教室単位のアラート（getAlertsLight / getAlertsHeavy を mergeStudentAlerts したもの）から、
 * 生徒ハブの「注意すること」に出す、この生徒1人分を抜き出す。
 *
 * 並びは生徒一覧のアラート欄の生徒カードと同じ（groupByStudentThenSeries の行順＝
 * 重要度の高い系列から → 同じ重さならラベル順。同じ系列の中は取得した順）。
 * ★applyDismissAndSort は生徒を名簿順に並べるだけで、1人の中のアラートを重要度では並べない。
 *   重要度順はカード側（groupByStudentThenSeries）が作っているので、それに揃える。
 */
export function pickStudentAttentionAlerts(
  studentAlerts: StudentAlerts[],
  studentId: string,
  isTeacher: boolean
): Alert[] {
  const roleHidden = alertTypesHiddenForRole(isTeacher);
  const mine = studentAlerts.filter((sa) => sa.student_id === studentId);
  const filtered = mine.map((sa) => ({
    ...sa,
    alerts: sa.alerts.filter(
      (a) => !roleHidden.has(a.alert_type) && !HUB_EXCLUDED_ALERT_TYPES.has(a.alert_type)
    ),
  }));
  return groupByStudentThenSeries(filtered).flatMap((g) => g.rows.flatMap((r) => r.alerts));
}
