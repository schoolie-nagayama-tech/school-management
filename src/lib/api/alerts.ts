import { supabase } from '../supabase';
import { listAssessmentsBySchool } from './assessments';
import { getInterviewsBySchool, getPendingTasks } from './interviews';
import { getApplicationItems, getStudentApplications } from './applications';
import { getStudents } from './students';
import { getStudentTextbooksExamsBySchool } from './progress';
import type {
  Alert,
  AlertDismissal,
  StudentAlerts,
  AlertType,
} from '@/types/alerts';
import { SUBJECT_LABELS } from '@/types/database';
import type { AssessmentWithScores } from '@/types/database';
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
}

// ============================================
// Phase 1: fetchAlertSources（DBアクセス専用）
// ============================================

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
    };
  }

  const [
    students,
    assessmentsByStudent,
    interviewsByStudent,
    applicationItems,
    applicationsResult,
    pendingTasksResult,
    textbooksResult,
  ] = await Promise.all([
    getStudents(undefined, schoolIds),
    listAssessmentsBySchool(schoolIds), // 全カテゴリ一括
    getInterviewsBySchool(schoolIds),
    getApplicationItems(schoolIds, false),
    getStudentApplications(schoolIds).catch(() => []),
    Promise.all(schoolIds.map((sid) => getPendingTasks(sid).catch(() => []))).then((arr) => arr.flat()),
    getStudentTextbooksExamsBySchool(schoolIds),
  ]);

  const applications = applicationsResult ?? [];
  const pendingTasks = pendingTasksResult ?? [];
  const { byStudent: textbooksByStudent, examTypeNames } = textbooksResult;

  return {
    students,
    assessmentsByStudent,
    interviewsByStudent,
    applicationItems,
    applications,
    pendingTasks,
    textbooksByStudent,
    examTypeNames,
  };
}

// ============================================
// Phase 2: buildAlertCandidates（pure function、dismiss未考慮）
// ============================================

/** 成績スコアは subject / value（DBスキーマ準拠） */
function getScoreMap(scores: { subject: string; value: number | null }[]) {
  return new Map(scores.map((s) => [s.subject, s.value]));
}

function buildScoreDropCandidates(sources: AlertSources): Alert[] {
  const alerts: Alert[] = [];
  const categories: Array<'regular_test' | 'report_card' | 'mock'> = ['regular_test', 'report_card', 'mock'];

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

      for (const [subjectCode, latestScore] of latestScores.entries()) {
        if (latestScore == null) continue;
        const previousScore = previousScores.get(subjectCode);
        if (previousScore == null) continue;
        const diff = latestScore - previousScore;
        if (diff <= -10) {
          const alertKey = `${category}:${subjectCode}:${latest.exam_month || latest.id}`;
          alerts.push({
            id: `${student.id}:score_drop:${alertKey}`,
            student_id: student.id,
            student_name: `${student.last_name} ${student.first_name}`,
            grade: student.grade,
            alert_type: 'score_drop',
            alert_key: alertKey,
            message: `${SUBJECT_LABELS[subjectCode] || subjectCode} ${diff}点`,
            details: { subject: subjectCode, previous_value: previousScore, current_value: latestScore, diff },
          });
        }
      }
    }
  }
  return alerts;
}

function buildScoreMissingCandidates(sources: AlertSources): Alert[] {
  const alerts: Alert[] = [];
  const categories: Array<'regular_test' | 'report_card' | 'mock'> = ['regular_test', 'report_card', 'mock'];

  for (const student of sources.students) {
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
      const expectedSubjects =
        category === 'mock'
          ? ['english', 'math', 'japanese', 'social', 'science', 'conv_5', 'conv_4', 'conv_total']
          : ['english', 'math', 'japanese', 'social', 'science', 'music', 'art', 'tech_home', 'pe'];

      const missingSubjects: string[] = [];
      for (const subj of expectedSubjects) {
        const score = latest.scores.find((s) => s.subject === subj);
        if (!score || score.value == null) missingSubjects.push(subj);
      }
      if (missingSubjects.length > 0) {
        const examMonthStr = latest.exam_month
          ? new Date(latest.exam_month).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })
          : '最新';
        const alertKey = `${category}:${latest.exam_month || latest.id}`;
        alerts.push({
          id: `${student.id}:score_missing:${alertKey}`,
          student_id: student.id,
          student_name: `${student.last_name} ${student.first_name}`,
          grade: student.grade,
          alert_type: 'score_missing',
          alert_key: alertKey,
          message: `${examMonthStr} ${missingSubjects.map((s) => SUBJECT_LABELS[s] || s).join('・')}`,
          details: { subject: missingSubjects.join(',') },
        });
      }
    }
  }
  return alerts;
}

function buildInterviewOverdueCandidates(sources: AlertSources): Alert[] {
  const alerts: Alert[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const student of sources.students) {
    const interviews = sources.interviewsByStudent.get(student.id) ?? [];
    const lastInterviewDate =
      interviews.length > 0 ? (() => { const d = new Date(interviews[0].interview_date); d.setHours(0, 0, 0, 0); return d; })() : null;
    const daysDiff = lastInterviewDate
      ? Math.floor((today.getTime() - lastInterviewDate.getTime()) / (1000 * 60 * 60 * 24))
      : Infinity;

    if (daysDiff > 30) {
      const alertKey = `interview:${lastInterviewDate ? lastInterviewDate.toISOString().split('T')[0] : 'never'}`;
      alerts.push({
        id: `${student.id}:interview_overdue:${alertKey}`,
        student_id: student.id,
        student_name: `${student.last_name} ${student.first_name}`,
        grade: student.grade,
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
  const alerts: Alert[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const overdueItems = sources.applicationItems.filter((item) => {
    if (item.column_type !== 'check') return false;
    if (!item.due_date) return false;
    const dueDate = new Date(item.due_date);
    dueDate.setHours(0, 0, 0, 0);
    return dueDate < today;
  });

  for (const student of sources.students) {
    for (const item of overdueItems) {
      const app = sources.applications.find((a) => a.student_id === student.id && a.item_id === item.id);
      if (app?.status === 'completed' || app?.status === 'not_applicable') continue;

      const alertKey = `application:${item.id}:${item.due_date}`;
      const dueDateStr = item.due_date
        ? new Date(item.due_date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
        : '';
      alerts.push({
        id: `${student.id}:application_overdue:${alertKey}`,
        student_id: student.id,
        student_name: `${student.last_name} ${student.first_name}`,
        grade: student.grade,
        alert_type: 'application_overdue',
        alert_key: alertKey,
        message: `${item.name}（期日: ${dueDateStr}）`,
        details: { item_name: item.name, due_date: item.due_date ?? undefined },
      });
    }
  }
  return alerts;
}

function buildInterviewTaskCandidates(sources: AlertSources): Alert[] {
  const alerts: Alert[] = [];
  const studentMap = new Map(sources.students.map((s) => [s.id, s]));

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

    alerts.push({
      id: `${studentId}:interview_task:${alertKey}`,
      student_id: studentId,
      student_name: studentName,
      grade,
      alert_type: 'interview_task',
      alert_key: alertKey,
      message: taskDateStr ? `${taskDateStr}: ${contentPreview}` : contentPreview || 'タスク',
      details: { task_id: task.id, interview_date: task.interview_date, content: task.content ?? undefined },
    });
  }
  return alerts;
}

function buildExamOverdueCandidates(sources: AlertSources): Alert[] {
  const alerts: Alert[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const student of sources.students) {
    const textbooks = sources.textbooksByStudent.get(student.id) ?? [];
    for (const st of textbooks) {
      for (const exam of st.exams ?? []) {
        if (!exam.exam_date) continue;
        const examDate = new Date(exam.exam_date);
        examDate.setHours(0, 0, 0, 0);
        const daysUntil = Math.ceil((examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntil >= 0) continue;

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
};

/** Light 用の alert types */
const LIGHT_ALERT_TYPES: AlertType[] = ['interview_overdue', 'application_overdue', 'interview_task'];

/** Heavy 用の alert types */
const HEAVY_ALERT_TYPES: AlertType[] = ['score_drop', 'score_missing', 'exam_overdue'];

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
    };
  }

  const [students, interviewsByStudent, applicationItems, applicationsResult, pendingTasksResult] =
    await Promise.all([
      getStudents(undefined, schoolIds),
      getInterviewsBySchool(schoolIds),
      getApplicationItems(schoolIds, false),
      getStudentApplications(schoolIds).catch(() => []),
      Promise.all(schoolIds.map((sid) => getPendingTasks(sid).catch(() => []))).then((arr) => arr.flat()),
    ]);

  return {
    students,
    interviewsByStudent,
    applicationItems,
    applications: applicationsResult ?? [],
    pendingTasks: pendingTasksResult ?? [],
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
    };
  }

  const [students, assessmentsByStudent, textbooksResult] = await Promise.all([
    getStudents(undefined, schoolIds),
    listAssessmentsBySchool(schoolIds),
    getStudentTextbooksExamsBySchool(schoolIds),
  ]);

  const { byStudent: textbooksByStudent, examTypeNames } = textbooksResult;

  if (process.env.NODE_ENV === 'development') {
    const assessmentCount = Array.from(assessmentsByStudent.values()).reduce((n, arr) => n + arr.length, 0);
    console.debug('[Heavy] schoolIds:', schoolIds.length, 'students:', students.length, 'assessments:', assessmentCount, 'textbooksByStudent:', textbooksByStudent.size);
  }

  return {
    students,
    assessmentsByStudent,
    textbooksByStudent,
    examTypeNames,
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
