/**
 * notifications.ts
 *
 * 通知フィード（NotificationFeed）のデータ取得・変換ロジックを
 * クライアント/サーバー共有の純関数として提供する。
 *
 * 狙い: Phase3 SSR 計画 Pillar B の一環として、生徒管理ページ表示時の
 * ハイドレーション後 fetch 待ちを無くすため、サーバー側でも同じ FeedItem[]
 * を生成できるよう、React state 操作を含まない純粋な取得関数を切り出す。
 * NotificationFeed.tsx と notification-server.ts が同じ関数を呼ぶことで
 * ロジック二重管理を防ぐ。
 */

import { supabase } from '@/lib/supabase';
import { getRecentUnprocessedResponses } from '@/lib/api/form-responses';
import { FORM_TYPE_LABELS, GRADE_LABELS, STATUS_LABELS } from '@/types/database';

// ── 型定義（export: コンポーネント・サーバー関数から参照） ──

export type FeedItemType = 'response' | 'update' | 'shift' | 'deadline' | 'transcript';

export interface FeedItem {
  id: string;
  type: FeedItemType;
  timestamp: string;
  // response 系
  formType?: string;
  formLabel?: string;
  formPeriod?: string;
  schoolId?: string;
  // update 系
  action?: string;
  changeSummary?: string;
  studentId?: string;
  // shift 系
  shiftType?: 'seasonal' | 'regular';
  shiftSettingId?: string;
  shiftSettingName?: string;
  teacherEmail?: string;
  // deadline 系
  deadlineType?: 'overdue' | 'upcoming';
  deadlineSource?: 'monthly' | 'schedule';
  deadlineDate?: string;
  deadlineHref?: string;
  incompleteSchoolIds?: string[];
  // transcript 系
  transcriptId?: string;
  transcriptTitle?: string;
  // 共通
  studentName: string;
  gradeLabel?: string;
}

/** 通知フィード SSR 初期データの型（notification-server.ts が返し、NotificationFeed が受け取る） */
export interface NotificationInitialData {
  feedItems: FeedItem[];
}

// ── 内部型定義 ──

interface StudentLogEntry {
  id: string;
  student_id: string;
  school_id: string;
  action: string;
  diff: Record<string, { old: unknown; new: unknown }> | null;
  created_at: string;
  student: {
    last_name: string;
    first_name: string;
    grade: number;
    status: string;
  } | null;
}

// ── 内部ヘルパー ──

/**
 * フィールド値を表示用文字列に変換する。
 * student_logs.diff に格納された生の値を人間が読める形にする。
 */
function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(なし)';
  if (key === 'grade' && typeof value === 'number') return GRADE_LABELS[value] ?? String(value);
  if (key === 'status' && typeof value === 'string') return STATUS_LABELS[value as keyof typeof STATUS_LABELS] ?? value;
  if (key === 'is_programming') return value === true ? '受講中' : '未受講';
  if (typeof value === 'boolean') return value ? 'あり' : 'なし';
  return String(value);
}

/** フィールドラベルマップ（表示専用の FIELD_LABELS は描画側に残し、変換に使うものをここで定義） */
const FIELD_LABELS_FOR_TRANSFORM: Record<string, string> = {
  last_name: '姓',
  first_name: '名',
  last_name_kana: 'セイ',
  first_name_kana: 'メイ',
  grade: '学年',
  status: '在籍状況',
  school_name: '学校名',
  class_name: 'クラス',
  club: '部活',
  student_code: '生徒コード',
  subject_other: 'その他科目',
  is_programming: 'プログラミング受講',
};

/**
 * diff から意味のある変更（表示値が変わったフィールド）だけを抽出する。
 * updated_at/created_at の自動更新は除外する。
 */
function getMeaningfulChanges(
  diff: Record<string, { old: unknown; new: unknown }> | null
): Array<{ label: string; old: string; new: string }> {
  if (!diff) return [];
  const changes: Array<{ label: string; old: string; new: string }> = [];
  for (const [key, val] of Object.entries(diff)) {
    if (key === 'updated_at' || key === 'created_at') continue;
    if (!val) continue;
    const oldDisplay = formatValue(key, val.old);
    const newDisplay = formatValue(key, val.new);
    if (oldDisplay === newDisplay) continue;
    const label = FIELD_LABELS_FOR_TRANSFORM[key] ?? key;
    changes.push({ label, old: oldDisplay, new: newDisplay });
  }
  return changes;
}

/**
 * アクションと diff から「登録」「姓: 旧→新, ...」などの変更サマリを生成する。
 */
function buildChangeSummary(
  action: string,
  diff: Record<string, { old: unknown; new: unknown }> | null
): string {
  if (action === 'created') return '新規登録';
  if (action === 'soft_deleted') return '削除';
  if (action === 'restored') return '復元';
  const changes = getMeaningfulChanges(diff);
  if (changes.length === 0) return '';
  return changes.map((c) => `${c.label}: ${c.old}→${c.new}`).join(', ');
}

/**
 * フィードに表示する意味のある変更が含まれているか判定する。
 * 操作系アクション（created/soft_deleted/restored）は常に表示対象。
 * updated/status_changed は diff に実質的な変化がある場合のみ表示。
 */
function hasMeaningfulChanges(log: StudentLogEntry): boolean {
  if (log.action === 'created' || log.action === 'soft_deleted' || log.action === 'restored') {
    return true;
  }
  const changes = getMeaningfulChanges(
    log.diff as Record<string, { old: unknown; new: unknown }> | null
  );
  return changes.length > 0;
}

// ── 公開関数 ──

/**
 * 通知フィードのデータを取得し FeedItem[] に変換して返す。
 *
 * NotificationFeed.tsx の fetchData と notification-server.ts の prefetchNotificationInitial
 * が共通で呼び出す。React state 操作を含まない純関数。
 *
 * @param schoolIds 対象教室IDの配列（0件の場合は空配列を即返し）
 * @param client DI用クライアント（省略時はブラウザクライアント。SSR事前取得時は RLS 認証済みサーバークライアントを渡す）
 * @returns FeedItem[] を時系列降順（新しい順）でソートして返す
 */
export async function loadNotificationFeed(
  schoolIds: string[],
  client: typeof supabase = supabase
): Promise<FeedItem[]> {
  if (schoolIds.length === 0) return [];

  // ── 日付計算 ──
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const todayStr = new Date().toISOString().split('T')[0];
  const upcomingDate = new Date();
  upcomingDate.setDate(upcomingDate.getDate() + 3); // 期日3日以内
  const upcomingStr = upcomingDate.toISOString().split('T')[0];
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  // ── 並行取得 ──
  const [
    responsesResult,
    logsResult,
    seasonalShiftResult,
    regularShiftResult,
    monthlyTasksResult,
    scheduleTasksResult,
    transcriptsResult,
  ] = await Promise.allSettled([
    // 新着未処理フォーム回答（DI化した client を渡す）
    getRecentUnprocessedResponses(schoolIds, 7, 20, client),
    // 生徒更新ログ
    client
      .from('student_logs')
      .select(
        'id, student_id, school_id, action, diff, created_at, student:students!student_logs_student_id_fkey(last_name, first_name, grade, status)'
      )
      .in('school_id', schoolIds)
      .in('action', ['updated', 'status_changed'])
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(20),
    // 講習シフト申請
    client
      .from('seasonal_shift_submissions')
      .select(
        'id, setting_id, school_id, teacher_name, teacher_email, submitted_at, created_at, setting:seasonal_shift_settings!seasonal_shift_submissions_setting_id_fkey(name)'
      )
      .in('school_id', schoolIds)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(20),
    // 通常シフト申請
    client
      .from('regular_shift_submissions')
      .select(
        'id, setting_id, school_id, teacher_name, teacher_email, submitted_at, created_at, setting:regular_shift_settings!regular_shift_submissions_setting_id_fkey(name)'
      )
      .in('school_id', schoolIds)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(20),
    // 業務進捗: 期日超過 + 3日以内の未完了タスク
    (async () => {
      const { data: tasks } = await client
        .from('monthly_tasks')
        .select(
          'id, task_date, task_name, category, checks:monthly_task_checks(task_id, school_id, is_completed)'
        )
        .eq('year', currentYear)
        .eq('month', currentMonth)
        .lte('task_date', upcomingStr);
      return tasks || [];
    })(),
    // 講習準備スケジュール: 期日超過 + 3日以内の未完了タスク
    (async () => {
      const { data: tasks } = await client
        .from('course_prep_schedule_tasks')
        .select('id, name, deadline, end_date, is_completed, school_id')
        .in('school_id', schoolIds)
        .eq('is_completed', false);
      return tasks || [];
    })(),
    // 文字起こし紐付け
    client
      .from('notta_transcripts')
      .select(
        'id, title, school_id, linked_student_id, linked_at, student:students!notta_transcripts_linked_student_id_fkey(last_name, first_name, grade)'
      )
      .in('school_id', schoolIds)
      .not('linked_at', 'is', null)
      .gte('linked_at', since.toISOString())
      .order('linked_at', { ascending: false })
      .limit(20),
  ]);

  const items: FeedItem[] = [];

  // ── 回答データ → FeedItem ──
  if (responsesResult.status === 'fulfilled') {
    const responses = responsesResult.value;
    responses.forEach((r) => {
      items.push({
        id: `response_${r.id}`,
        type: 'response',
        timestamp: r.created_at,
        formType: r.form_type,
        formLabel: FORM_TYPE_LABELS[r.form_type] ?? r.form_type,
        formPeriod: r.form_period,
        schoolId: r.school_id,
        studentId: r.linked_student_id ?? undefined,
        studentName: r.student_name,
        gradeLabel: GRADE_LABELS[r.grade] ?? `学年${r.grade}`,
      });
    });
  }

  // ── 更新ログ → FeedItem ──
  if (logsResult.status === 'fulfilled' && !logsResult.value.error) {
    const logs = (logsResult.value.data || []) as unknown as StudentLogEntry[];
    logs
      .filter((l) => hasMeaningfulChanges(l))
      .forEach((l) => {
        const student = l.student;
        const summary = buildChangeSummary(
          l.action,
          l.diff as Record<string, { old: unknown; new: unknown }> | null
        );
        items.push({
          id: `update_${l.id}`,
          type: 'update',
          timestamp: l.created_at,
          action: l.action,
          changeSummary: summary,
          studentId: l.student_id,
          schoolId: l.school_id,
          studentName: student ? `${student.last_name} ${student.first_name}` : '(不明)',
        });
      });
  }

  // ── シフト申請 → FeedItem（seasonal/regular 共通ヘルパー） ──
  const processShiftResult = (
    result: PromiseSettledResult<{ data: unknown[] | null; error: unknown }>,
    shiftType: 'seasonal' | 'regular'
  ) => {
    if (result.status !== 'fulfilled' || result.value.error) return;
    const submissions = (result.value.data || []) as Array<{
      id: string;
      setting_id: string;
      school_id: string;
      teacher_name: string;
      teacher_email: string;
      submitted_at: string;
      created_at: string;
      setting: { name: string } | null;
    }>;
    submissions.forEach((s) => {
      items.push({
        id: `shift_${shiftType}_${s.id}`,
        type: 'shift',
        timestamp: s.created_at,
        shiftType,
        shiftSettingId: s.setting_id,
        shiftSettingName: s.setting?.name ?? '',
        teacherEmail: s.teacher_email,
        schoolId: s.school_id,
        studentName: s.teacher_name, // 講師名を共通フィールドで表示
      });
    });
  };
  processShiftResult(seasonalShiftResult, 'seasonal');
  processShiftResult(regularShiftResult, 'regular');

  // ── 業務進捗: 超過 + 期日3日以内の未完了タスク → FeedItem ──
  if (monthlyTasksResult.status === 'fulfilled') {
    const tasks = monthlyTasksResult.value as Array<{
      id: string;
      task_date: string;
      task_name: string;
      category: string;
      checks: Array<{ task_id: string; school_id: string; is_completed: boolean }>;
    }>;
    tasks.forEach((task) => {
      // 対象教室のうち未完了の school_id を収集
      const incompleteSchoolIds = schoolIds.filter((sid) => {
        const check = task.checks?.find((c) => c.school_id === sid);
        return !check || !check.is_completed;
      });
      if (incompleteSchoolIds.length === 0) return;

      const isOverdue = task.task_date < todayStr;
      const isUpcoming = !isOverdue && task.task_date <= upcomingStr;
      if (!isOverdue && !isUpcoming) return;

      items.push({
        id: `deadline_monthly_${task.id}`,
        type: 'deadline',
        timestamp: task.task_date + 'T00:00:00',
        deadlineType: isOverdue ? 'overdue' : 'upcoming',
        deadlineSource: 'monthly',
        deadlineDate: task.task_date,
        deadlineHref: '/tasks',
        studentName: task.task_name,
        incompleteSchoolIds,
      });
    });
  }

  // ── 講習準備スケジュール: 超過 + 期日3日以内の未完了タスク → FeedItem ──
  if (scheduleTasksResult.status === 'fulfilled') {
    const tasks = scheduleTasksResult.value as Array<{
      id: string;
      name: string;
      deadline: string | null;
      end_date: string | null;
      is_completed: boolean;
      school_id: string;
    }>;
    // タスク名でグループ化（同名タスクは1つに集約）
    const seenNames = new Set<string>();
    tasks.forEach((task) => {
      if (task.is_completed) return;
      const dueDate = task.deadline || task.end_date;
      if (!dueDate) return;
      if (seenNames.has(task.name)) return;

      const isOverdue = dueDate < todayStr;
      const isUpcoming = !isOverdue && dueDate <= upcomingStr;
      if (!isOverdue && !isUpcoming) return;

      seenNames.add(task.name);
      items.push({
        id: `deadline_schedule_${task.id}`,
        type: 'deadline',
        timestamp: dueDate + 'T00:00:00',
        deadlineType: isOverdue ? 'overdue' : 'upcoming',
        deadlineSource: 'schedule',
        deadlineDate: dueDate,
        deadlineHref: '/courses/schedule',
        schoolId: task.school_id,
        studentName: task.name,
      });
    });
  }

  // ── 文字起こし紐付け → FeedItem ──
  if (transcriptsResult.status === 'fulfilled' && !transcriptsResult.value.error) {
    const transcripts = (transcriptsResult.value.data || []) as unknown as Array<{
      id: string;
      title: string | null;
      school_id: string;
      linked_student_id: string | null;
      linked_at: string;
      student: { last_name: string; first_name: string; grade: number } | null;
    }>;
    transcripts.forEach((t) => {
      if (!t.student) return;
      items.push({
        id: `transcript_${t.id}`,
        type: 'transcript',
        timestamp: t.linked_at,
        transcriptId: t.id,
        transcriptTitle: t.title ?? '(無題)',
        studentId: t.linked_student_id ?? undefined,
        schoolId: t.school_id,
        studentName: `${t.student.last_name} ${t.student.first_name}`,
        gradeLabel: GRADE_LABELS[t.student.grade] ?? `学年${t.student.grade}`,
      });
    });
  }

  // ── 時系列ソート（新しい順） ──
  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return items;
}
