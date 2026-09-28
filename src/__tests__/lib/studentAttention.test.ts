import { describe, it, expect } from 'vitest';
import {
  alertTypesHiddenForRole,
  pickStudentAttentionAlerts,
  HUB_EXCLUDED_ALERT_TYPES,
} from '@/lib/alerts/studentAttention';
import type { Alert, AlertType, StudentAlerts } from '@/types/alerts';

function makeAlert(student_id: string, alert_type: AlertType, opts: Partial<Alert> = {}): Alert {
  const alert_key = opts.alert_key ?? 'k';
  return {
    id: `${student_id}:${alert_type}:${alert_key}`,
    student_id,
    student_name: '生徒',
    grade: 8,
    alert_type,
    alert_key,
    message: 'msg',
    ...opts,
  };
}

function student(id: string, alerts: Alert[]): StudentAlerts {
  return { student_id: id, student_name: '生徒', grade: 8, alerts };
}

describe('pickStudentAttentionAlerts（生徒ハブの注意すること）', () => {
  it('この生徒の分だけを返し、面談更新と未完了タスクを除く', () => {
    const list = [
      student('s1', [
        makeAlert('s1', 'interview_overdue'),
        makeAlert('s1', 'interview_task'),
        makeAlert('s1', 'interview_recent'),
        makeAlert('s1', 'application_overdue'),
      ]),
      student('s2', [makeAlert('s2', 'tardy', { severity: 'danger' })]),
    ];
    const result = pickStudentAttentionAlerts(list, 's1', false);
    expect(result.map((a) => a.alert_type).sort()).toEqual([
      'application_overdue',
      'interview_overdue',
    ]);
    expect(result.every((a) => a.student_id === 's1')).toBe(true);
  });

  it('重要度の高い系列から並べる（生徒一覧のカードと同じ順）', () => {
    const list = [
      student('s1', [
        makeAlert('s1', 'score_missing'), // warning
        makeAlert('s1', 'tardy', { severity: 'info' }),
        makeAlert('s1', 'score_drop', { severity: 'danger', alert_key: 'math' }),
        makeAlert('s1', 'score_drop', { severity: 'warning', alert_key: 'eng' }),
      ]),
    ];
    const result = pickStudentAttentionAlerts(list, 's1', false);
    expect(result.map((a) => a.alert_type)).toEqual([
      'score_drop',
      'score_drop',
      'score_missing',
      'tardy',
    ]);
  });

  it('講師ではロールの絞り込み（講師に出さない種別）もかかる', () => {
    const list = [
      student('s1', [makeAlert('s1', 'course_prep_overdue'), makeAlert('s1', 'tardy')]),
    ];
    expect(pickStudentAttentionAlerts(list, 's1', true).map((a) => a.alert_type)).toEqual([
      'tardy',
    ]);
    expect(pickStudentAttentionAlerts(list, 's1', false)).toHaveLength(2);
  });

  it('該当が無ければ空配列', () => {
    expect(pickStudentAttentionAlerts([], 's1', false)).toEqual([]);
  });
});

describe('alertTypesHiddenForRole', () => {
  it('教室長以上は面談更新だけを外す（生徒一覧のアラート欄と同じ）', () => {
    expect(Array.from(alertTypesHiddenForRole(false))).toEqual(['interview_recent']);
    expect(alertTypesHiddenForRole(true).has('interview_task')).toBe(true);
    expect(HUB_EXCLUDED_ALERT_TYPES.has('interview_task')).toBe(true);
  });
});
