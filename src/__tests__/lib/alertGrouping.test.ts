import { describe, it, expect } from 'vitest';
import {
  resolveSeverity,
  groupAlertsBySeries,
  groupByStudentThenSeries,
} from '@/lib/alerts/grouping';
import type { Alert, AlertType, StudentAlerts } from '@/types/alerts';

/** テスト用に Alert を組み立てる */
function makeAlert(
  overrides: Partial<Alert> & { alert_type: AlertType; student_id: string }
): Alert {
  const { alert_type, student_id } = overrides;
  return {
    id: overrides.id ?? `${student_id}:${alert_type}:${overrides.alert_key ?? 'k'}`,
    student_id,
    student_name: overrides.student_name ?? '生徒',
    grade: overrides.grade ?? 8,
    alert_type,
    alert_key: overrides.alert_key ?? 'k',
    message: overrides.message ?? 'msg',
    details: overrides.details,
    severity: overrides.severity,
    school_id: overrides.school_id,
  };
}

/** 1生徒＝1 StudentAlerts に畳む */
function student(id: string, name: string, grade: number, alerts: Alert[]): StudentAlerts {
  return { student_id: id, student_name: name, grade, school_id: alerts[0]?.school_id, alerts };
}

describe('resolveSeverity', () => {
  it('ビルダーが設定した severity を最優先する', () => {
    const a = makeAlert({
      alert_type: 'interview_overdue',
      student_id: 's1',
      severity: 'info',
      details: { days_overdue: 999 },
    });
    expect(resolveSeverity(a)).toBe('info');
  });

  it('interview_overdue: 60日以上/記録なしは danger、それ未満は warning', () => {
    const base = { alert_type: 'interview_overdue' as const, student_id: 's1' };
    expect(resolveSeverity(makeAlert({ ...base, details: { days_overdue: 70 } }))).toBe('danger');
    expect(resolveSeverity(makeAlert({ ...base, details: { days_overdue: 20 } }))).toBe('warning');
    // 面談記録なし = Infinity
    expect(resolveSeverity(makeAlert({ ...base, details: { days_overdue: Infinity } }))).toBe(
      'danger'
    );
  });

  it('exam_overdue: 7日以上経過は danger', () => {
    const base = { alert_type: 'exam_overdue' as const, student_id: 's1' };
    expect(resolveSeverity(makeAlert({ ...base, details: { days_overdue: 10 } }))).toBe('danger');
    expect(resolveSeverity(makeAlert({ ...base, details: { days_overdue: 3 } }))).toBe('warning');
  });

  it('interview_task: 期日超過は danger、間近は warning、先は info、未定は warning', () => {
    const base = { alert_type: 'interview_task' as const, student_id: 's1' };
    expect(resolveSeverity(makeAlert({ ...base, details: { days_until_due: -1 } }))).toBe('danger');
    expect(resolveSeverity(makeAlert({ ...base, details: { days_until_due: 1 } }))).toBe('warning');
    expect(resolveSeverity(makeAlert({ ...base, details: { days_until_due: 5 } }))).toBe('info');
    expect(resolveSeverity(makeAlert({ ...base }))).toBe('warning');
  });

  it('score_missing は warning', () => {
    expect(resolveSeverity(makeAlert({ alert_type: 'score_missing', student_id: 's1' }))).toBe(
      'warning'
    );
  });
});

describe('groupAlertsBySeries', () => {
  it('系列（alert_type）ごとにセクション化する', () => {
    const students = [
      student('s1', '青木', 8, [
        makeAlert({ alert_type: 'homework_not_done', student_id: 's1', severity: 'warning' }),
      ]),
      student('s2', '井上', 8, [makeAlert({ alert_type: 'score_missing', student_id: 's2' })]),
    ];
    const sections = groupAlertsBySeries(students);
    const types = sections.map((s) => s.alert_type).sort();
    expect(types).toEqual(['homework_not_done', 'score_missing']);
  });

  it('同一生徒×同一系列の複数アラートは1行に集約する', () => {
    const students = [
      student('s1', '青木', 8, [
        makeAlert({ alert_type: 'score_missing', student_id: 's1', alert_key: 'a' }),
        makeAlert({ alert_type: 'score_missing', student_id: 's1', alert_key: 'b' }),
      ]),
    ];
    const [section] = groupAlertsBySeries(students);
    expect(section.studentCount).toBe(1);
    expect(section.alertCount).toBe(2);
    expect(section.rows).toHaveLength(1);
    expect(section.rows[0].alerts).toHaveLength(2);
  });

  it('danger を含むセクションが上に来る', () => {
    const students = [
      student('s1', '青木', 8, [
        makeAlert({ alert_type: 'interview_recent', student_id: 's1', severity: 'info' }),
      ]),
      student('s2', '井上', 8, [
        makeAlert({ alert_type: 'homework_not_done', student_id: 's2', severity: 'danger' }),
      ]),
    ];
    const sections = groupAlertsBySeries(students);
    expect(sections[0].alert_type).toBe('homework_not_done'); // danger 系列が先頭
    expect(sections[0].severity).toBe('danger');
  });

  it('セクション内の行は severity の高い順→氏名順', () => {
    const students = [
      student('s1', '田中', 8, [
        makeAlert({ alert_type: 'homework_not_done', student_id: 's1', severity: 'warning' }),
      ]),
      student('s2', '安藤', 8, [
        makeAlert({ alert_type: 'homework_not_done', student_id: 's2', severity: 'danger' }),
      ]),
      student('s3', '佐藤', 8, [
        makeAlert({ alert_type: 'homework_not_done', student_id: 's3', severity: 'warning' }),
      ]),
    ];
    const [section] = groupAlertsBySeries(students);
    // danger(安藤) が先頭、その後 warning を氏名順（佐藤→田中）
    expect(section.rows.map((r) => r.student_name)).toEqual(['安藤', '佐藤', '田中']);
  });

  it('行の severity は集約したアラートの最大値になる', () => {
    const students = [
      student('s1', '青木', 8, [
        makeAlert({ alert_type: 'score_drop', student_id: 's1', severity: 'info', alert_key: 'a' }),
        makeAlert({
          alert_type: 'score_drop',
          student_id: 's1',
          severity: 'danger',
          alert_key: 'b',
        }),
      ]),
    ];
    const [section] = groupAlertsBySeries(students);
    expect(section.rows[0].severity).toBe('danger');
    expect(section.severity).toBe('danger');
  });
});

describe('groupByStudentThenSeries', () => {
  it('人（生徒）ごとにまとめ、同一系列は1行に集約する', () => {
    const students = [
      student('s1', '青木', 8, [
        makeAlert({ alert_type: 'homework_not_done', student_id: 's1', severity: 'warning' }),
        makeAlert({
          alert_type: 'score_missing',
          student_id: 's1',
          alert_key: 'a',
        }),
        makeAlert({
          alert_type: 'score_missing',
          student_id: 's1',
          alert_key: 'b',
        }),
      ]),
    ];
    const groups = groupByStudentThenSeries(students);
    expect(groups).toHaveLength(1);
    expect(groups[0].student_id).toBe('s1');
    // 系列は homework_not_done と score_missing の2行（score_missing の2件は1行に集約）
    expect(groups[0].rows).toHaveLength(2);
    const scoreRow = groups[0].rows.find((r) => r.alert_type === 'score_missing');
    expect(scoreRow?.alerts).toHaveLength(2);
  });

  it('生徒は severity の高い順に並ぶ', () => {
    const students = [
      student('s1', '青木', 8, [
        makeAlert({ alert_type: 'interview_recent', student_id: 's1', severity: 'info' }),
      ]),
      student('s2', '井上', 8, [
        makeAlert({ alert_type: 'homework_not_done', student_id: 's2', severity: 'danger' }),
      ]),
    ];
    const groups = groupByStudentThenSeries(students);
    expect(groups[0].student_id).toBe('s2'); // danger の生徒が先頭
    expect(groups[0].severity).toBe('danger');
  });

  it('生徒内の系列行は severity の高い順に並ぶ', () => {
    const students = [
      student('s1', '青木', 8, [
        makeAlert({ alert_type: 'interview_recent', student_id: 's1', severity: 'info' }),
        makeAlert({ alert_type: 'homework_not_done', student_id: 's1', severity: 'danger' }),
      ]),
    ];
    const [group] = groupByStudentThenSeries(students);
    expect(group.rows[0].alert_type).toBe('homework_not_done'); // danger が先頭
    expect(group.rows[0].severity).toBe('danger');
  });
});
