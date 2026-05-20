import { supabase } from '../supabase';
import { listAssessmentsBySchool } from './assessments';
import { getInterviewsBySchool, getPendingTasksBySchools } from './interviews';
import { getApplicationItems, getStudentApplications } from './applications';
import { getStudents } from './students';
import { getStudentTextbooksExamsBySchool } from './progress';
import { getAlertSettingsBySchools, pickStrictestThreshold } from './alertSettings';
import type {
  Alert,
  AlertDismissal,
  AlertSetting,
  AlertSeverity,
  StudentAlerts,
  AlertType,
} from '@/types/alerts';
import { DEFAULT_ALERT_THRESHOLDS } from '@/types/alerts';
import { SUBJECT_LABELS, ASSESSMENT_NAME_LABELS } from '@/types/database';
import type { AssessmentWithScores, SeasonType } from '@/types/database';
import type { StudentInterview } from '@/types/database';
import type { StudentTextbookWithDetails } from '@/types/database';

// ============================================
// 型定義
// ============================================

export interface AlertSources {
  students: Awaited<ReturnType<typeof getStudents>>;
  assessmentsByStudent: Map<string, AssessmentWithScores[]>;
  interviewsByStudent: Map<string, StudentInterview[]>;
  applicationItems: Awaited<ReturnType<typeof getApplicationItems>>;
  applications: Awaited<ReturnType<typeof getStudentApplications>>;
  pendingTasks: Array<StudentInterview & { student: { last_name: string; first_name: string } }>;
  textbooksByStudent: Map<string, StudentTextbookWithDetails[]>;
  examTypeNames: Map<string, string>;
  /** 生徒ごとの宿題未実施・遅刻カウント */
  homeworkCountByStudent: Map<string, number>;
  tardyCountByStudent: Map<string, number>;
  /** 講習準備：期日付き進捗項目と生徒完了状態 */
  coursePrepItems: Array<{ id: string; school_id: string; name: string; deadline: string; season: SeasonType; year: number }>;
  coursePrepStudentProgress: Array<{ student_id: string; item_id: string; status: string | null }>;
  /** 行動目標が1件以上存在するテスト設定のIDセット */
  actionGoalExamIds: Set<string>;
  /** 設定（教室別の最も厳しい値を採用） */
  settingsBySchool: Map<string, AlertSetting[]>;
}

// ============================================
// Phase 1: fetchAlertSources（DBアクセス専用）
// ============================================

/** student_progress から生徒ごとの宿題未実施・遅刻のカウントを取得 */
async function fetchProgressFlagsByStudent(
  schoolIds: string[]
): Promise<{ homework: Map<string, number>; tardy: Map<string, number> }> {
  const homework = new Map<string, number>();
  const tardy = new Map<string, number>();
  if (schoolIds.length === 0) return { homework, tardy };

  // student_textbooks 経由で school_id をフィルタし、紐づく student_progress を集計
  const { data, error } = await supabase
    .from('student_progress')
    .select('homework_not_done, tardy, student_textbook:student_textbooks!inner(student_id, school_id)')
    .in('student_textbook.school_id', schoolIds)
    .or('homework_not_done.eq.true,tardy.eq.true');

  if (error) {
    if (error.code === '42703' || error.message.includes('schema cache')) {
      // カラム未マイグレーション
      return { homework, tardy };
    }
    console.warn('進行表フラグ取得に失敗:', error);
    return { homework, tardy };
  }

  for (const row of (data ?? []) as Array<{
    homework_not_done: boolean;
    tardy: boolean;
    student_textbook: { student_id: string } | { student_id: string }[] | null;
  }>) {
    const st = Array.isArray(row.student_textbook) ? row.student_textbook[0] : row.student_textbook;
    if (!st) continue;
    if (row.homework_not_done) {
      homework.set(st.student_id, (homework.get(st.student_id) ?? 0) + 1);
    }
    if (row.tardy) {
      tardy.set(st.student_id, (tardy.get(st.student_id) ?? 0) + 1);
    }
  }
  return { homework, tardy };
}

/**
 * アラート計算に必要な全データをバッチ取得
 */
export async function fetchAlertSources(schoolIds: string[]): Promise<AlertSources> {
  if (schoolIds.length === 0) {
    return {
      students: [],
      assessmentsByStudent: new Map(),
      interviewsByStudent: new Map(),
      applicationItems: [],
      applications: [],
      pendingTasks: [],
      textbooksByStudent: new Map(),
      examTypeNames: new Map(),
      homeworkCountByStudent: new Map(),
      tardyCountByStudent: new Map(),
      coursePrepItems: [],
      coursePrepStudentProgress: [],
      actionGoalExamIds: new Set(),
      settingsBySchool: new Map(),
    };
  }

  const [
    allStudents,
    assessmentsByStudent,
    interviewsByStudent,
    applicationItems,
    applicationsResult,
    pendingTasksResult,
    textbooksResult,
    progressFlags,
    coursePrepData,
    settingsBySchool,
  ] = await Promise.all([
    getStudents(undefined, schoolIds),
    listAssessmentsBySchool(schoolIds),
    getInterviewsBySchool(schoolIds),
    getApplicationItems(schoolIds, false),
    getStudentApplications(schoolIds).catch((e) => { console.warn('学生申込の取得に失敗しました:', e); return []; }),
    getPendingTasksBySchools(schoolIds).catch((e) => { console.warn('未完了タスクの取得に失敗しました:', e); return []; }),
    getStudentTextbooksExamsBySchool(schoolIds),
    fetchProgressFlagsByStudent(schoolIds),
    fetchCoursePrepAlertData(schoolIds),
    getAlertSettingsBySchools(schoolIds).catch(() => new Map<string, AlertSetting[]>()),
  ]);

  const students = allStudents.filter((s) => s.status === 'active');
  const applications = applicationsResult ?? [];
  const pendingTasks = pendingTasksResult ?? [];
  const { byStudent: textbooksByStudent, examTypeNames } = textbooksResult;

  // action_goals が存在するテスト設定IDを取得
  const allExamIds: string[] = [];
  Array.from(textbooksByStudent.values()).forEach((stList) => {
    for (const st of stList) {
      for (const exam of st.exams ?? []) allExamIds.push(exam.id);
    }
  });
  const actionGoalExamIds = new Set<string>();
  if (allExamIds.length > 0) {
    const { data: goals } = await supabase
      .from('action_goals')
      .select('student_textbook_exam_id')
      .in('student_textbook_exam_id', allExamIds);
    for (const g of (goals ?? []) as Array<{ student_textbook_exam_id: string }>) actionGoalExamIds.add(g.student_textbook_exam_id);
  }

  return {
    students,
    assessmentsByStudent,
    interviewsByStudent,
    applicationItems,
    applications,
    pendingTasks,
    textbooksByStudent,
    examTypeNames,
    homeworkCountByStudent: progressFlags.homework,
    tardyCountByStudent: progressFlags.tardy,
    coursePrepItems: coursePrepData.items,
    coursePrepStudentProgress: coursePrepData.studentProgress,
    actionGoalExamIds,
    settingsBySchool,
  };
}

// ============================================
// Phase 2: buildAlertCandidates（pure function、dismiss未考慮）
// ============================================

/** 成績スコアは subject / value（DBスキーマ準拠） */
function getScoreMap(scores: { subject: string; value: number | null }[]) {
  return new Map(scores.map((s) => [s.subject, s.value]));
}

/** 教室別設定をまとめて、最も厳しいしきい値（数値が小さいほど厳しい）を選ぶ */
function getStrictestThreshold(
  settingsBySchool: Map<string, AlertSetting[]>,
  alertType: AlertType,
  key: keyof typeof DEFAULT_ALERT_THRESHOLDS,
  mode: 'min' | 'max' = 'min'
): number {
  const collected: AlertSetting[] = [];
  for (const settings of Array.from(settingsBySchool.values()) as AlertSetting[][]) {
    const s = settings.find((x: AlertSetting) => x.alert_type === alertType);
    if (s) collected.push(s);
  }
  if (collected.length === 0) return DEFAULT_ALERT_THRESHOLDS[key] as number;
  return pickStrictestThreshold(collected, key, mode) as number;
}

/** いずれかの教室で当該アラートが無効ならスキップしないが、全教室で無効なら出さない */
function isAlertEnabled(settingsBySchool: Map<string, AlertSetting[]>, alertType: AlertType): boolean {
  if (settingsBySchool.size === 0) return true;
  for (const settings of Array.from(settingsBySchool.values()) as AlertSetting[][]) {
    const s = settings.find((x: AlertSetting) => x.alert_type === alertType);
    if (!s || s.enabled) return true;
  }
  return false;
}

function buildScoreDropCandidates(sources: AlertSources): Alert[] {
  if (!isAlertEnabled(sources.settingsBySchool, 'score_drop')) return [];
  const alerts: Alert[] = [];
  const categories: Array<'regular_test' | 'report_card' | 'mock'> = ['regular_test', 'report_card', 'mock'];
  const thresholdRegular = getStrictestThreshold(sources.settingsBySchool, 'score_drop', 'score_drop_regular');
  const thresholdMock = getStrictestThreshold(sources.settingsBySchool, 'score_drop', 'score_drop_mock');
  const thresholdReport = getStrictestThreshold(sources.settingsBySchool, 'score_drop', 'score_drop_report');
  const trendWindowMonths = getStrictestThreshold(sources.settingsBySchool, 'score_drop', 'trend_window_months', 'max');

  const thresholdFor = (cat: 'regular_test' | 'report_card' | 'mock') =>
    cat === 'regular_test' ? thresholdRegular : cat === 'mock' ? thresholdMock : thresholdReport;
  const unitFor = (cat: 'regular_test' | 'report_card' | 'mock') =>
    cat === 'regular_test' ? '点' : cat === 'mock' ? 'pt' : '段階';

  for (const student of sources.students) {
    const allAssessments = sources.assessmentsByStudent.get(student.id) ?? [];
    for (const category of categories) {
      const assessments = allAssessments
        .filter((a) => a.category === category)
        .sort((a, b) => {
          if (!a.exam_month || !b.exam_month) return 0;
          return b.exam_month.localeCompare(a.exam_month);
        });
      if (assessments.length < 2) continue;

      const latest = assessments[0];
      const previous = assessments[1];
      const latestScores = getScoreMap(latest.scores);
      const previousScores = getScoreMap(previous.scores);
      const threshold = thresholdFor(category);
      const unit = unitFor(category);

      for (const [subjectCode, latestScore] of Array.from(latestScores.entries())) {
        if (latestScore == null) continue;
        const previousScore = previousScores.get(subjectCode);
        if (previousScore == null) continue;
        const diff = latestScore - previousScore;
        if (diff > -threshold) continue;

        // 連続下降回数を計算
        let consecutive = 1;
        for (let i = 1; i < assessments.length - 1; i++) {
          const cur = getScoreMap(assessments[i].scores).get(subjectCode);
          const prv = getScoreMap(assessments[i + 1].scores).get(subjectCode);
          if (cur != null && prv != null && cur < prv) consecutive++;
          else break;
        }

        // 長期トレンド：trendWindowMonths 以内の最古点と比較して下落傾向か
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - trendWindowMonths);
        const inWindow = assessments.filter((a) => a.exam_month && new Date(a.exam_month) >= cutoff);
        const oldestInWindow = inWindow[inWindow.length - 1];
        const oldestScore = oldestInWindow ? getScoreMap(oldestInWindow.scores).get(subjectCode) : null;
        const longTermDecline =
          oldestScore != null && latestScore < oldestScore && inWindow.length >= 3;

        const severity: AlertSeverity =
          consecutive >= 3 || longTermDecline ? 'danger' : 'warning';

        const alertKey = `${category}:${subjectCode}:${latest.exam_month || latest.id}`;
        const subjLabel = SUBJECT_LABELS[subjectCode] || subjectCode;
        const trendBadge =
          consecutive >= 3 ? `（${consecutive}回連続下降）` : longTermDecline ? '（長期下落）' : '';
        alerts.push({
          id: `${student.id}:score_drop:${alertKey}`,
          student_id: student.id,
          student_name: `${student.last_name} ${student.first_name}`,
          grade: student.grade,
          school_id: student.school_id,
          alert_type: 'score_drop',
          alert_key: alertKey,
          message: `${subjLabel} ${diff}${unit}${trendBadge}`,
          details: {
            subject: subjectCode,
            previous_value: previousScore,
            current_value: latestScore,
            diff,
            score_category: category,
            consecutive_drops: consecutive,
            trend: longTermDecline ? 'declining_long_term' : null,
          },
          severity,
        });
      }
    }
  }
  return alerts;
}

function buildScoreMissingCandidates(sources: AlertSources): Alert[] {
  if (!isAlertEnabled(sources.settingsBySchool, 'score_missing')) return [];
  const alerts: Alert[] = [];
  const categories: Array<'regular_test' | 'report_card' | 'mock'> = ['regular_test', 'report_card', 'mock'];

  for (const student of sources.students) {
    // 小学生（grade <= 6）と高校生（grade >= 10）は除外。
    // 高校生は教科セットが学年で動的に変わり、空欄が増えるため未入力判定が正確にできない。
    if (student.grade != null && (student.grade <= 6 || student.grade >= 10)) continue;
    const allAssessments = sources.assessmentsByStudent.get(student.id) ?? [];
    for (const category of categories) {
      const assessments = allAssessments
        .filter((a) => a.category === category)
        .sort((a, b) => {
          if (!a.exam_month || !b.exam_month) return 0;
          return b.exam_month.localeCompare(a.exam_month);
        });
      if (assessments.length === 0) continue;

      const latest = assessments[0];
      // 中間テスト（name_codeに_midを含む or titleに中間を含む）は5教科のみ。
      // 期末・学年末・内申は9教科。
      const isMidterm = category === 'regular_test' && (
        latest.name_code?.includes('_mid') || latest.title?.includes('中間')
      );
      const expectedSubjects =
        category === 'mock'
          ? ['english', 'math', 'japanese', 'social', 'science', 'conv_5', 'conv_4', 'conv_total']
          : isMidterm
            ? ['english', 'math', 'japanese', 'social', 'science']
            : ['english', 'math', 'japanese', 'social', 'science', 'music', 'art', 'tech_home', 'pe'];

      const missingSubjects: string[] = [];
      for (const subj of expectedSubjects) {
        const score = latest.scores.find((s) => s.subject === subj);
        if (!score || score.value == null) missingSubjects.push(subj);
      }
      if (missingSubjects.length > 0) {
        const categoryLabel =
          category === 'regular_test' ? '定期テスト' : category === 'report_card' ? '内申' : '模試';
        const testName = ASSESSMENT_NAME_LABELS[latest.name_code] || '';
        const examMonthStr = latest.exam_month
          ? new Date(latest.exam_month).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })
          : '';
        const prefix = [categoryLabel, testName, examMonthStr].filter(Boolean).join(' ');
        const alertKey = `${category}:${latest.exam_month || latest.id}`;
        alerts.push({
          id: `${student.id}:score_missing:${alertKey}`,
          student_id: student.id,
          student_name: `${student.last_name} ${student.first_name}`,
          grade: student.grade,
          school_id: student.school_id,
          alert_type: 'score_missing',
          alert_key: alertKey,
          message: `${prefix} ${missingSubjects.map((s) => SUBJECT_LABELS[s] || s).join('・')}`,
          details: { subject: missingSubjects.join(',') },
        });
      }
    }
  }
  return alerts;
}

function buildInterviewOverdueCandidates(sources: AlertSources): Alert[] {
  if (!isAlertEnabled(sources.settingsBySchool, 'interview_overdue')) return [];
  const alerts: Alert[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueThreshold = getStrictestThreshold(
    sources.settingsBySchool,
    'interview_overdue',
    'interview_overdue_days'
  );

  for (const student of sources.students) {
    const interviews = sources.interviewsByStudent.get(student.id) ?? [];
    const lastInterviewDate =
      interviews.length > 0 ? (() => { const d = new Date(interviews[0].interview_date); d.setHours(0, 0, 0, 0); return d; })() : null;
    const daysDiff = lastInterviewDate
      ? Math.floor((today.getTime() - lastInterviewDate.getTime()) / (1000 * 60 * 60 * 24))
      : Infinity;

    if (daysDiff > overdueThreshold) {
      const alertKey = `interview:${lastInterviewDate ? lastInterviewDate.toISOString().split('T')[0] : 'never'}`;
      alerts.push({
        id: `${student.id}:interview_overdue:${alertKey}`,
        student_id: student.id,
        student_name: `${student.last_name} ${student.first_name}`,
        grade: student.grade,
        school_id: student.school_id,
        alert_type: 'interview_overdue',
        alert_key: alertKey,
        message: lastInterviewDate ? `${daysDiff}日経過` : '面談記録なし',
        details: { days_overdue: daysDiff },
      });
    }
  }
  return alerts;
}

function buildApplicationOverdueCandidates(sources: AlertSources): Alert[] {
  if (!isAlertEnabled(sources.settingsBySchool, 'application_overdue')) return [];
  const alerts: Alert[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const warnDays = getStrictestThreshold(
    sources.settingsBySchool,
    'application_overdue',
    'application_warn_days',
    'max'
  );
  const alertDays = getStrictestThreshold(
    sources.settingsBySchool,
    'application_overdue',
    'application_alert_days',
    'max'
  );

  // 警告開始日数（warnDays）以内の項目に絞る
  const upcomingItems = sources.applicationItems.filter((item) => {
    if (item.column_type !== 'check') return false;
    if (!item.due_date) return false;
    const dueDate = new Date(item.due_date);
    dueDate.setHours(0, 0, 0, 0);
    const daysDiff = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysDiff <= warnDays;
  });

  for (const student of sources.students) {
    for (const item of upcomingItems) {
      const app = sources.applications.find((a) => a.student_id === student.id && a.item_id === item.id);
      // 「空欄のとき」のみアラート対象。pending/completed/not_applicable はすべて除外
      if (app && app.status) continue;

      const dueDate = new Date(item.due_date!);
      dueDate.setHours(0, 0, 0, 0);
      const daysDiff = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      const alertKey = `application:${item.id}:${item.due_date}`;
      const dueDateStr = dueDate.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });

      // 段階表示：warnDays前=info / alertDays前=warning / 当日以降=danger
      let severity: AlertSeverity;
      let message: string;
      if (daysDiff > alertDays) {
        severity = 'info';
        message = `${item.name}（期日まで${daysDiff}日: ${dueDateStr}）`;
      } else if (daysDiff > 0) {
        severity = 'warning';
        message = `${item.name}（あと${daysDiff}日: ${dueDateStr}）`;
      } else if (daysDiff === 0) {
        severity = 'warning';
        message = `${item.name}（本日期日: ${dueDateStr}）`;
      } else {
        severity = 'danger';
        message = `${item.name}（${Math.abs(daysDiff)}日超過: ${dueDateStr}）`;
      }

      alerts.push({
        id: `${student.id}:application_overdue:${alertKey}`,
        student_id: student.id,
        student_name: `${student.last_name} ${student.first_name}`,
        grade: student.grade,
        school_id: student.school_id,
        alert_type: 'application_overdue',
        alert_key: alertKey,
        message,
        details: {
          item_name: item.name,
          due_date: item.due_date ?? undefined,
          days_until_due: daysDiff,
        },
        severity,
      });
    }
  }
  return alerts;
}

function buildInterviewTaskCandidates(sources: AlertSources): Alert[] {
  if (!isAlertEnabled(sources.settingsBySchool, 'interview_task')) return [];
  const alerts: Alert[] = [];
  const studentMap = new Map(sources.students.map((s) => [s.id, s]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const task of sources.pendingTasks) {
    const studentId = task.student_id;
    const student = studentMap.get(studentId);
    const studentName = student
      ? `${student.last_name} ${student.first_name}`
      : `${task.student?.last_name ?? ''} ${task.student?.first_name ?? ''}`.trim() || '（不明）';
    const grade = student?.grade ?? 0;

    const alertKey = `task:${task.id}`;
    const taskDateStr = task.interview_date
      ? new Date(task.interview_date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
      : '';
    const contentPreview = task.content
      ? (task.content.length > 50 ? task.content.substring(0, 50) + '...' : task.content)
      : '';

    // 期日までの日数を計算
    let daysUntilDue: number | undefined;
    if (task.interview_date) {
      const taskDate = new Date(task.interview_date);
      taskDate.setHours(0, 0, 0, 0);
      daysUntilDue = Math.ceil((taskDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    }

    alerts.push({
      id: `${studentId}:interview_task:${alertKey}`,
      student_id: studentId,
      student_name: studentName,
      grade,
      school_id: student?.school_id,
      alert_type: 'interview_task',
      alert_key: alertKey,
      message: taskDateStr ? `${taskDateStr}: ${contentPreview}` : contentPreview || 'タスク',
      details: {
        task_id: task.id,
        interview_date: task.interview_date,
        content: task.content ?? undefined,
        days_until_due: daysUntilDue,
      },
    });
  }
  return alerts;
}

function buildExamOverdueCandidates(sources: AlertSources): Alert[] {
  if (!isAlertEnabled(sources.settingsBySchool, 'exam_overdue')) return [];
  const alerts: Alert[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueThreshold = getStrictestThreshold(
    sources.settingsBySchool,
    'exam_overdue',
    'exam_overdue_days'
  );

  for (const student of sources.students) {
    const textbooks = sources.textbooksByStudent.get(student.id) ?? [];
    for (const st of textbooks) {
      for (const exam of st.exams ?? []) {
        if (!exam.exam_date) continue;
        // 目標点 or 行動目標が設定済みなら目標未設定ではない
        if (exam.target_score != null) continue;
        if (sources.actionGoalExamIds.has(exam.id)) continue;

        const examDate = new Date(exam.exam_date);
        examDate.setHours(0, 0, 0, 0);
        const daysUntil = Math.ceil((examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntil > -overdueThreshold) continue;

        const examName = exam.custom_exam_name ?? sources.examTypeNames.get(exam.exam_type_id ?? '') ?? 'テスト';
        const textbookName = (st as { textbook?: { name: string } }).textbook?.name ?? 'テキスト';
        const examDateStr = examDate.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
        const daysDiff = Math.floor((today.getTime() - examDate.getTime()) / (1000 * 60 * 60 * 24));

        const alertKey = `exam:${exam.id}`;
        alerts.push({
          id: `${student.id}:exam_overdue:${alertKey}`,
          student_id: student.id,
          student_name: `${student.last_name} ${student.first_name}`,
          grade: student.grade,
          school_id: student.school_id,
          alert_type: 'exam_overdue',
          alert_key: alertKey,
          message: `${textbookName}: ${examName}（${examDateStr}、${daysDiff}日経過）`,
          details: {
            exam_id: exam.id,
            exam_date: exam.exam_date,
            exam_name: examName,
            textbook_name: textbookName,
            days_overdue: daysDiff,
          },
        });
      }
    }
  }
  return alerts;
}

function buildOccurrenceAlert(
  sources: AlertSources,
  alertType: 'homework_not_done' | 'tardy',
  countMap: Map<string, number>,
  warnKey: 'homework_warn_count' | 'tardy_warn_count',
  dangerKey: 'homework_danger_count' | 'tardy_danger_count',
  label: string
): Alert[] {
  if (!isAlertEnabled(sources.settingsBySchool, alertType)) return [];
  const warn = getStrictestThreshold(sources.settingsBySchool, alertType, warnKey);
  const danger = getStrictestThreshold(sources.settingsBySchool, alertType, dangerKey);
  const alerts: Alert[] = [];
  for (const student of sources.students) {
    const count = countMap.get(student.id) ?? 0;
    if (count < warn) continue;
    const severity: AlertSeverity = count >= danger ? 'danger' : count >= warn + 1 ? 'warning' : 'info';
    alerts.push({
      id: `${student.id}:${alertType}:count`,
      student_id: student.id,
      student_name: `${student.last_name} ${student.first_name}`,
      grade: student.grade,
      school_id: student.school_id,
      alert_type: alertType,
      alert_key: 'count',
      message: `${label} ${count}回`,
      details: { occurrence_count: count },
      severity,
    });
  }
  return alerts;
}

function buildHomeworkNotDoneCandidates(sources: AlertSources): Alert[] {
  return buildOccurrenceAlert(
    sources,
    'homework_not_done',
    sources.homeworkCountByStudent,
    'homework_warn_count',
    'homework_danger_count',
    '宿題未実施'
  );
}

function buildTardyCandidates(sources: AlertSources): Alert[] {
  return buildOccurrenceAlert(
    sources,
    'tardy',
    sources.tardyCountByStudent,
    'tardy_warn_count',
    'tardy_danger_count',
    '遅刻'
  );
}

// ============================================
// 講習準備アラート用データ取得
// ============================================

function getCoursePrepSeason(): SeasonType {
  const month = new Date().getMonth() + 1;
  if (month >= 2 && month <= 5) return 'spring';
  if (month >= 5 && month <= 9) return 'summer';
  return 'winter';
}

async function fetchCoursePrepAlertData(schoolIds: string[]): Promise<{
  items: AlertSources['coursePrepItems'];
  studentProgress: AlertSources['coursePrepStudentProgress'];
}> {
  if (schoolIds.length === 0) return { items: [], studentProgress: [] };

  const season = getCoursePrepSeason();
  const year = new Date().getFullYear();

  try {
    const { data: items, error: itemsError } = await supabase
      .from('course_prep_progress_items')
      .select('id, school_id, name, deadline, season, year')
      .in('school_id', schoolIds)
      .eq('season', season)
      .eq('year', year)
      .eq('is_hidden', false)
      .eq('column_type', 'check')
      .not('deadline', 'is', null);

    if (itemsError) {
      console.warn('講習準備アラートデータ取得エラー:', itemsError);
      return { items: [], studentProgress: [] };
    }

    if (!items || items.length === 0) return { items: [], studentProgress: [] };

    const itemIds = items.map((i: { id: string }) => i.id);
    const { data: progress } = await supabase
      .from('course_prep_student_progress')
      .select('student_id, item_id, status')
      .in('item_id', itemIds);

    return {
      items: items as AlertSources['coursePrepItems'],
      studentProgress: (progress || []) as AlertSources['coursePrepStudentProgress'],
    };
  } catch (e) {
    console.warn('講習準備アラートデータ取得エラー:', e);
    return { items: [], studentProgress: [] };
  }
}

function buildCoursePrepOverdueCandidates(sources: AlertSources): Alert[] {
  if (!isAlertEnabled(sources.settingsBySchool, 'course_prep_overdue')) return [];
  if (sources.coursePrepItems.length === 0) return [];

  const alerts: Alert[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const warnDays = getStrictestThreshold(
    sources.settingsBySchool, 'course_prep_overdue', 'course_prep_warn_days', 'max'
  );

  const completedSet = new Set<string>();
  for (const p of sources.coursePrepStudentProgress) {
    if (p.status === 'completed' || p.status === 'not_applicable') {
      completedSet.add(`${p.student_id}:${p.item_id}`);
    }
  }

  for (const item of sources.coursePrepItems) {
    const dueDate = new Date(item.deadline + 'T00:00:00');
    const daysDiff = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > warnDays) continue;

    const studentsInSchool = sources.students.filter((s) => s.school_id === item.school_id);
    for (const student of studentsInSchool) {
      if (completedSet.has(`${student.id}:${item.id}`)) continue;

      const dueDateStr = dueDate.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
      const alertKey = `course_prep:${item.id}`;

      let severity: AlertSeverity;
      let message: string;
      if (daysDiff > 0) {
        severity = 'info';
        message = `${item.name}（あと${daysDiff}日: ${dueDateStr}）`;
      } else if (daysDiff === 0) {
        severity = 'warning';
        message = `${item.name}（本日期日: ${dueDateStr}）`;
      } else {
        severity = 'danger';
        message = `${item.name}（${Math.abs(daysDiff)}日超過: ${dueDateStr}）`;
      }

      alerts.push({
        id: `${student.id}:course_prep_overdue:${alertKey}`,
        student_id: student.id,
        student_name: `${student.last_name} ${student.first_name}`,
        grade: student.grade,
        school_id: student.school_id,
        alert_type: 'course_prep_overdue',
        alert_key: alertKey,
        message,
        details: {
          item_name: item.name,
          due_date: item.deadline,
          days_until_due: daysDiff,
        },
        severity,
      });
    }
  }
  return alerts;
}

export type AlertLevel = 'warning' | 'info';

/** Phase 3: アラート定義のデータ駆動化（追加・表示制御を一元管理） */
export const ALERT_DEFINITIONS: Record<
  AlertType,
  { level: AlertLevel; evaluator: (sources: AlertSources) => Alert[] }
> = {
  score_drop: { level: 'warning', evaluator: buildScoreDropCandidates },
  score_missing: { level: 'warning', evaluator: buildScoreMissingCandidates },
  interview_overdue: { level: 'info', evaluator: buildInterviewOverdueCandidates },
  application_overdue: { level: 'info', evaluator: buildApplicationOverdueCandidates },
  interview_task: { level: 'info', evaluator: buildInterviewTaskCandidates },
  exam_overdue: { level: 'warning', evaluator: buildExamOverdueCandidates },
  homework_not_done: { level: 'warning', evaluator: buildHomeworkNotDoneCandidates },
  tardy: { level: 'warning', evaluator: buildTardyCandidates },
  course_prep_overdue: { level: 'warning', evaluator: buildCoursePrepOverdueCandidates },
};

/** Light 用の alert types */
const LIGHT_ALERT_TYPES: AlertType[] = ['interview_overdue', 'application_overdue', 'interview_task'];

/** Heavy 用の alert types */
const HEAVY_ALERT_TYPES: AlertType[] = ['score_drop', 'score_missing', 'exam_overdue', 'homework_not_done', 'tardy', 'course_prep_overdue'];

/**
 * 全アラート候補を生成（pure、dismiss 未考慮、ALERT_DEFINITIONS 駆動）
 */
export function buildAlertCandidates(sources: AlertSources): Alert[] {
  return (Object.keys(ALERT_DEFINITIONS) as AlertType[]).flatMap((type) =>
    ALERT_DEFINITIONS[type].evaluator(sources)
  );
}

// ============================================
// Phase 3: school 単位短期キャッシュ（TTL 15秒）
// ============================================

const ALERT_CACHE_TTL_MS = 15_000;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cacheLight = new Map<string, CacheEntry<StudentAlerts[]>>();
const cacheHeavy = new Map<string, CacheEntry<StudentAlerts[]>>();

function cacheKey(schoolIds: string[]): string {
  return [...schoolIds].sort().join(',');
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + ALERT_CACHE_TTL_MS });
}

/**
 * アラートキャッシュを無効化（dismiss 後などに呼び出す）
 */
export function invalidateAlertCache(schoolIds: string[]): void {
  const key = cacheKey(schoolIds);
  cacheLight.delete(key);
  cacheHeavy.delete(key);
}

// ============================================
// applyDismissAndSort（UI都合処理）
// ============================================

/**
 * dismiss でフィルタし、生徒ごとにグループ化・ソート（同一 id は重複除去）
 */
export function applyDismissAndSort(
  candidates: Alert[],
  dismissedSet: Set<string>
): StudentAlerts[] {
  const filtered = candidates.filter((a) => !dismissedSet.has(a.id));
  const studentAlertsMap = new Map<string, StudentAlerts>();
  const seenAlertIds = new Set<string>();

  for (const alert of filtered) {
    if (seenAlertIds.has(alert.id)) continue;
    seenAlertIds.add(alert.id);

    if (!studentAlertsMap.has(alert.student_id)) {
      studentAlertsMap.set(alert.student_id, {
        student_id: alert.student_id,
        student_name: alert.student_name,
        grade: alert.grade,
        school_id: alert.school_id,
        alerts: [],
      });
    }
    studentAlertsMap.get(alert.student_id)!.alerts.push(alert);
  }

  return Array.from(studentAlertsMap.values()).sort((a, b) => {
    if (a.grade !== b.grade) return a.grade - b.grade;
    return a.student_name.localeCompare(b.student_name, 'ja');
  });
}

// ============================================
// 公開API
// ============================================

/**
 * 対応済み記録を取得
 */
export async function getAlertDismissals(schoolIds: string[]): Promise<AlertDismissal[]> {
  const { data, error } = await supabase
    .from('alert_dismissals')
    .select('*')
    .in('school_id', schoolIds);

  if (error) {
    if (error.code === 'PGRST116' || error.message.includes('schema cache')) {
      console.warn('alert_dismissalsテーブルが見つかりません。マイグレーションを実行してください:', error);
      return [];
    }
    throw new Error(`対応済み記録の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as AlertDismissal[];
}

/**
 * アラートを対応済みにする
 */
export async function dismissAlert(
  schoolId: string,
  studentId: string,
  alertType: AlertType,
  alertKey: string,
  userId?: string,
  note?: string
): Promise<AlertDismissal> {
  const { data, error } = await supabase
    .from('alert_dismissals')
    .insert({
      school_id: schoolId,
      student_id: studentId,
      alert_type: alertType,
      alert_key: alertKey,
      dismissed_by: userId || null,
      note: note || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '42501') {
      throw new Error(`対応済み記録の作成に失敗しました: RLSポリシー違反。マイグレーションを確認してください。${error.message}`);
    }
    throw new Error(`対応済み記録の作成に失敗しました: ${error.message}`);
  }

  return data as AlertDismissal;
}

/**
 * 対応済みを取り消す
 */
export async function undismissAlert(
  schoolId: string,
  studentId: string,
  alertType: AlertType,
  alertKey: string
): Promise<void> {
  const { error } = await supabase
    .from('alert_dismissals')
    .delete()
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .eq('alert_type', alertType)
    .eq('alert_key', alertKey);

  if (error) {
    throw new Error(`対応済み記録の削除に失敗しました: ${error.message}`);
  }
}

/**
 * Light アラート用ソースのみ取得（interview, application, task）
 */
async function fetchAlertSourcesLight(schoolIds: string[]): Promise<Partial<AlertSources>> {
  if (schoolIds.length === 0) {
    return {
      students: [],
      interviewsByStudent: new Map(),
      applicationItems: [],
      applications: [],
      pendingTasks: [],
      coursePrepItems: [],
      coursePrepStudentProgress: [],
      settingsBySchool: new Map(),
    };
  }

  const [allStudents, interviewsByStudent, applicationItems, applicationsResult, pendingTasksResult, settingsBySchool] =
    await Promise.all([
      getStudents(undefined, schoolIds),
      getInterviewsBySchool(schoolIds),
      getApplicationItems(schoolIds, false),
      getStudentApplications(schoolIds).catch(() => []),
      getPendingTasksBySchools(schoolIds).catch((e) => { console.warn('未完了タスクの取得に失敗しました:', e); return []; }),
      getAlertSettingsBySchools(schoolIds).catch(() => new Map<string, AlertSetting[]>()),
    ]);
  const students = allStudents.filter((s) => s.status === 'active');

  return {
    students,
    interviewsByStudent,
    applicationItems,
    applications: applicationsResult ?? [],
    pendingTasks: pendingTasksResult ?? [],
    settingsBySchool,
  };
}

/**
 * Heavy アラート用ソースのみ取得（assessments, textbooks/exams）
 */
async function fetchAlertSourcesHeavy(schoolIds: string[]): Promise<Partial<AlertSources>> {
  if (schoolIds.length === 0) {
    return {
      students: [],
      assessmentsByStudent: new Map(),
      textbooksByStudent: new Map(),
      examTypeNames: new Map(),
      homeworkCountByStudent: new Map(),
      tardyCountByStudent: new Map(),
      coursePrepItems: [],
      coursePrepStudentProgress: [],
      actionGoalExamIds: new Set<string>(),
      settingsBySchool: new Map(),
    };
  }

  const [allStudents, assessmentsByStudent, textbooksResult, progressFlags, coursePrepData, settingsBySchool] = await Promise.all([
    getStudents(undefined, schoolIds),
    listAssessmentsBySchool(schoolIds),
    getStudentTextbooksExamsBySchool(schoolIds),
    fetchProgressFlagsByStudent(schoolIds),
    fetchCoursePrepAlertData(schoolIds),
    getAlertSettingsBySchools(schoolIds).catch(() => new Map<string, AlertSetting[]>()),
  ]);
  const students = allStudents.filter((s) => s.status === 'active');

  const { byStudent: textbooksByStudent, examTypeNames } = textbooksResult;

  // action_goals が存在するテスト設定IDを取得
  const allExamIds: string[] = [];
  Array.from(textbooksByStudent.values()).forEach((stList) => {
    for (const st of stList) {
      for (const exam of st.exams ?? []) allExamIds.push(exam.id);
    }
  });
  const actionGoalExamIds = new Set<string>();
  if (allExamIds.length > 0) {
    const { data: goals } = await supabase
      .from('action_goals')
      .select('student_textbook_exam_id')
      .in('student_textbook_exam_id', allExamIds);
    for (const g of (goals ?? []) as Array<{ student_textbook_exam_id: string }>) actionGoalExamIds.add(g.student_textbook_exam_id);
  }

  if (process.env.NODE_ENV === 'development') {
    const assessmentCount = Array.from(assessmentsByStudent.values()).reduce((n, arr) => n + arr.length, 0);
    console.debug('[Heavy] schoolIds:', schoolIds.length, 'students:', students.length, 'assessments:', assessmentCount, 'textbooksByStudent:', textbooksByStudent.size);
  }

  return {
    students,
    assessmentsByStudent,
    textbooksByStudent,
    examTypeNames,
    homeworkCountByStudent: progressFlags.homework,
    tardyCountByStudent: progressFlags.tardy,
    coursePrepItems: coursePrepData.items,
    coursePrepStudentProgress: coursePrepData.studentProgress,
    actionGoalExamIds,
    settingsBySchool,
  };
}

function toFullSources(partial: Partial<AlertSources>): AlertSources {
  return {
    students: partial.students ?? [],
    assessmentsByStudent: partial.assessmentsByStudent ?? new Map(),
    interviewsByStudent: partial.interviewsByStudent ?? new Map(),
    applicationItems: partial.applicationItems ?? [],
    applications: partial.applications ?? [],
    pendingTasks: partial.pendingTasks ?? [],
    textbooksByStudent: partial.textbooksByStudent ?? new Map(),
    examTypeNames: partial.examTypeNames ?? new Map(),
    homeworkCountByStudent: partial.homeworkCountByStudent ?? new Map(),
    tardyCountByStudent: partial.tardyCountByStudent ?? new Map(),
    coursePrepItems: partial.coursePrepItems ?? [],
    coursePrepStudentProgress: partial.coursePrepStudentProgress ?? [],
    actionGoalExamIds: partial.actionGoalExamIds ?? new Set(),
    settingsBySchool: partial.settingsBySchool ?? new Map(),
  };
}

/** Light アラートの candidates を構築（3タイプのみ、ALERT_DEFINITIONS 駆動） */
function buildAlertCandidatesLight(sources: Partial<AlertSources>): Alert[] {
  if (!sources.students?.length) return [];
  const full = toFullSources(sources);
  return LIGHT_ALERT_TYPES.flatMap((type) => ALERT_DEFINITIONS[type].evaluator(full));
}

/** Heavy アラートの candidates を構築（3タイプのみ、ALERT_DEFINITIONS 駆動） */
function buildAlertCandidatesHeavy(sources: Partial<AlertSources>): Alert[] {
  if (!sources.students?.length) return [];
  const full = toFullSources(sources);
  return HEAVY_ALERT_TYPES.flatMap((type) => ALERT_DEFINITIONS[type].evaluator(full));
}

export interface GetAlertsOptions {
  /** キャッシュをスキップして再取得（dismiss 後の再取得など） */
  skipCache?: boolean;
}

/**
 * Light アラートのみ取得（速い：interview_overdue, application_overdue, interview_task）
 */
export async function getAlertsLight(
  schoolIds: string[],
  opts: GetAlertsOptions = {}
): Promise<StudentAlerts[]> {
  const key = cacheKey(schoolIds);
  if (!opts.skipCache) {
    const cached = getCached(cacheLight, key);
    if (cached) return cached;
  }

  const [sources, dismissals] = await Promise.all([
    fetchAlertSourcesLight(schoolIds),
    getAlertDismissals(schoolIds),
  ]);
  const dismissedSet = new Set(dismissals.map((d) => `${d.student_id}:${d.alert_type}:${d.alert_key}`));
  const candidates = buildAlertCandidatesLight(sources);
  const result = applyDismissAndSort(candidates, dismissedSet);
  setCached(cacheLight, key, result);
  return result;
}

/**
 * Heavy アラートのみ取得（重い：score_drop, score_missing, exam_overdue）
 */
export async function getAlertsHeavy(
  schoolIds: string[],
  opts: GetAlertsOptions = {}
): Promise<StudentAlerts[]> {
  const key = cacheKey(schoolIds);
  if (!opts.skipCache) {
    const cached = getCached(cacheHeavy, key);
    if (cached) return cached;
  }

  const [sources, dismissals] = await Promise.all([
    fetchAlertSourcesHeavy(schoolIds),
    getAlertDismissals(schoolIds),
  ]);
  const dismissedSet = new Set(dismissals.map((d) => `${d.student_id}:${d.alert_type}:${d.alert_key}`));
  const candidates = buildAlertCandidatesHeavy(sources);
  const result = applyDismissAndSort(candidates, dismissedSet);
  setCached(cacheHeavy, key, result);
  return result;
}

/**
 * 2つの StudentAlerts[] をマージ（同一生徒のアラートを結合、同一 id は重複除去）
 */
export function mergeStudentAlerts(a: StudentAlerts[], b: StudentAlerts[]): StudentAlerts[] {
  const map = new Map<string, StudentAlerts>();
  for (const sa of [...a, ...b]) {
    const existing = map.get(sa.student_id);
    if (existing) {
      const seenIds = new Set(existing.alerts.map((x) => x.id));
      for (const alert of sa.alerts) {
        if (!seenIds.has(alert.id)) {
          seenIds.add(alert.id);
          existing.alerts.push(alert);
        }
      }
    } else {
      map.set(sa.student_id, { ...sa, alerts: [...sa.alerts] });
    }
  }
  return Array.from(map.values()).sort((x, y) => {
    if (x.grade !== y.grade) return x.grade - y.grade;
    return x.student_name.localeCompare(y.student_name, 'ja');
  });
}

/**
 * 全アラートを取得（集計エンジン化済み）
 */
export async function getAlerts(schoolIds: string[]): Promise<StudentAlerts[]> {
  const [sources, dismissals] = await Promise.all([
    fetchAlertSources(schoolIds),
    getAlertDismissals(schoolIds),
  ]);

  const dismissedSet = new Set(dismissals.map((d) => `${d.student_id}:${d.alert_type}:${d.alert_key}`));
  const candidates = buildAlertCandidates(sources);
  return applyDismissAndSort(candidates, dismissedSet);
}
