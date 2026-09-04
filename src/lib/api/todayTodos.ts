/**
 * ダッシュボード「今日やること」のデータ層。
 *
 * 設計方針:
 *  - 「組み立て」と「取得」を分ける。build* は fetch を一切含まない純関数で、
 *    引数で受けたデータだけから TodayTodoItem[] を作る（テスト可能にするため）。
 *  - 取得は Light / Heavy の2段。ページを開いた直後は Light だけで描画し、
 *    重い集計（成績アラート・報告書）は後追いで足す。
 *  - どれか1本のソースが落ちてもリスト全体を落とさない（Promise.allSettled）。
 */
import { getAlertsHeavy, getAlertsLight } from '@/lib/api/alerts';
import { getOverdueReports, getPendingReports } from '@/lib/api/class-reports';
import type { OverdueReportTarget } from '@/lib/api/class-reports';
import { getProgressWidget } from '@/lib/api/monthlyTasks';
import type { ProgressWidgetTask } from '@/lib/api/monthlyTasks';
import { getOrders } from '@/lib/api/ordering';
import { getActiveTimeSlots, getPendingTransfers, getScheduleEntries } from '@/lib/api/schedule';
import { getTeacherAbsences } from '@/lib/api/teacher-absences';
import type { Alert, StudentAlerts } from '@/types/alerts';
import type { MaterialOrderWithDetails } from '@/types/database';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';
import { compareTodayTodos } from '@/types/today-todos';
import type { TodayTodoItem, TodayTodoUrgency } from '@/types/today-todos';

/** その生徒が今日“最初に”来るコマ。行を時間順に並べるための位置情報。 */
export interface TodaySlotInfo {
  slotNumber: number;
  slotTime?: string;
}

/** 生徒ID → 今日最初のコマ。 */
export type SlotByStudentId = Map<string, TodaySlotInfo>;

// ============================================================
// 小さなユーティリティ
// ============================================================

/**
 * 取消・振替元は「その日には起きない授業」なので、当日の段取りからは全て除外する。
 * （振替元の“振替先を決める”用事は buildTransferTodos が別途扱う）
 */
function isActiveEntry(entry: ScheduleEntry): boolean {
  return entry.status !== 'cancelled' && entry.status !== 'transferred_out';
}

/** 'YYYY-MM-DD' → 'M/D'（ゼロ埋めしない。掲示物ではなく画面の補足なので短さを優先）。 */
function formatMonthDay(date: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date);
  if (!m) return date;
  return `${Number(m[2])}/${Number(m[3])}`;
}

/** from → to の日数差。タイムゾーンで1日ずれないよう UTC 固定で計算する。 */
function diffDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** 'HH:MM:SS' → 'HH:MM'。 */
function toHhMm(time: string | null | undefined): string | undefined {
  if (!time) return undefined;
  return time.slice(0, 5);
}

function formatSlotTime(slot: ScheduleTimeSlot | undefined): string | undefined {
  const start = toHhMm(slot?.start_time);
  const end = toHhMm(slot?.end_time);
  if (!start || !end) return undefined;
  return `${start}〜${end}`;
}

/**
 * 名前の羅列を「A、B、Cほか2名」に畳む。
 * 全部並べると1行に収まらず、逆に件数だけだと誰の話か分からないため、先頭数件＋残数にする。
 */
function joinWithMore(names: string[], max: number, unit: string): string {
  const head = names.slice(0, max).join('、');
  const rest = names.length - max;
  return rest > 0 ? `${head}ほか${rest}${unit}` : head;
}

/**
 * 期限の補足文。「締切 9/5（あと5日）」「締切 9/5（本日）」「締切 9/5（3日超過）」。
 * due_date が無いアラート（面談タスクなど）は残り日数だけで伝える。
 */
function buildDueNote(dueDate?: string, daysUntilDue?: number): string | undefined {
  if (!dueDate && daysUntilDue == null) return undefined;

  const suffix =
    daysUntilDue == null
      ? ''
      : daysUntilDue > 0
        ? `（あと${daysUntilDue}日）`
        : daysUntilDue === 0
          ? '（本日）'
          : `（${-daysUntilDue}日超過）`;

  if (dueDate) return `締切 ${formatMonthDay(dueDate)}${suffix}`;

  // 日付が無い場合は「締切 —」と書けないので、残り日数を主語にする
  if (daysUntilDue == null) return undefined;
  if (daysUntilDue > 0) return `期限まであと${daysUntilDue}日`;
  if (daysUntilDue === 0) return '期限は本日';
  return `期限を${-daysUntilDue}日超過`;
}

/** 生徒名。体験の見込み客は students を持たないので inquiry 側へフォールバックする。 */
function resolveEntryStudentName(entry: ScheduleEntry): string {
  if (entry.student) return `${entry.student.last_name}${entry.student.first_name}`;
  if (entry.inquiry?.student_name) return entry.inquiry.student_name;
  return '（氏名未登録）';
}

/** アラートの severity を目立たせ方に写す。 */
function urgencyFromSeverity(alert: Alert): TodayTodoUrgency {
  if (alert.severity === 'danger') return 'high';
  if (alert.severity === 'warning') return 'medium';
  return 'low';
}

// ============================================================
// 1. 当日の座席（欠勤・未配置・体験）
// ============================================================

export interface BuildSeatTodosInput {
  /** 当日のスケジュールエントリ（取消・振替元を含んでいてよい。内部で除外する） */
  entries: ScheduleEntry[];
  /** 講師欠勤のキー集合。キーは `${date}|${timeSlotId}|${teacherId}` */
  absenceKeySet: Set<string>;
  timeSlots: ScheduleTimeSlot[];
  teacherNameById: Map<string, string>;
  today: string;
}

/**
 * 当日の座席表から「今すぐ人を動かさないと授業が回らない」用事を拾う。
 * 欠勤・担当未定・体験は、どれもその日のうちに手当てしないと授業が成立しないため urgency=high。
 */
export function buildSeatTodos(input: BuildSeatTodosInput): TodayTodoItem[] {
  const { entries, absenceKeySet, timeSlots, teacherNameById, today } = input;
  const active = entries.filter(isActiveEntry);
  const slotById = new Map(timeSlots.map((s) => [s.id, s]));

  const resolveSlotNumber = (entry: ScheduleEntry): number | undefined =>
    (entry.time_slot ?? slotById.get(entry.time_slot_id))?.slot_number;

  const items: TodayTodoItem[] = [];

  // --- 欠勤: 講師が来ない = そのコマの生徒が宙に浮く。対象の生徒数まで出さないと動けない ---
  // tsconfig の target が低く Set の直接 for-of が使えないため Array.from で回す
  for (const key of Array.from(absenceKeySet)) {
    const [date, timeSlotId, teacherId] = key.split('|');
    const slotNumber = slotById.get(timeSlotId)?.slot_number;
    const targets = active.filter(
      (e) => e.entry_date === date && e.time_slot_id === timeSlotId && e.teacher_id === teacherId
    );
    const teacherName = teacherNameById.get(teacherId) ?? '講師';
    const slotLabel = slotNumber != null ? `${slotNumber}限 ` : '';

    items.push({
      id: `absence:${key}`,
      source: 'seat',
      label: '欠勤',
      title: `${slotLabel}${teacherName}先生が欠勤 — 代講の手配か振替の調整`,
      note: targets.length > 0 ? `対象の生徒${targets.length}名` : 'このコマの授業はなし',
      slotNumber,
      slotTime: formatSlotTime(slotById.get(timeSlotId)),
      urgency: 'high',
      href: '/schedule',
    });
  }

  // --- 未配置: 生徒1人ずつ出すと同じコマの話が縦に並んでうるさいので、時限ごとに1件へ畳む ---
  const unplacedBySlot = new Map<string, ScheduleEntry[]>();
  for (const entry of active) {
    const noTeacher = !entry.teacher_id;
    const plannable = entry.status === 'scheduled' || entry.status === 'transferred_in';
    if (!noTeacher || !plannable) continue;
    const list = unplacedBySlot.get(entry.time_slot_id);
    if (list) list.push(entry);
    else unplacedBySlot.set(entry.time_slot_id, [entry]);
  }
  for (const [slotId, group] of Array.from(unplacedBySlot.entries())) {
    const slotNumber = slotById.get(slotId)?.slot_number ?? resolveSlotNumber(group[0]);
    const names = group.map(resolveEntryStudentName);
    const slotLabel = slotNumber != null ? `${slotNumber}限` : 'コマ';

    items.push({
      id: `unplaced:${today}|${slotId}`,
      source: 'seat',
      label: '未配置',
      title: `${slotLabel}の担当講師が未定（${group.length}名）`,
      note: joinWithMore(names, 3, '名'),
      slotNumber,
      slotTime: formatSlotTime(slotById.get(slotId)),
      urgency: 'high',
      href: '/schedule',
    });
  }

  // --- 体験: 準備の中身が生徒ごとに違うので畳まず1件ずつ出す ---
  for (const entry of active) {
    if (entry.kind !== 'trial') continue;
    const name = resolveEntryStudentName(entry);
    const slotNumber = resolveSlotNumber(entry);
    const subjectNames = (entry.subjects ?? []).map((s) => s.name).filter(Boolean);

    items.push({
      id: `trial:${entry.id}`,
      source: 'seat',
      label: '体験',
      title: `体験授業 ${name}さん — 教材の準備と保護者対応`,
      note: subjectNames.length > 0 ? subjectNames.join('・') : undefined,
      // 未入会の見込み客は students を持たないため、student_id がある場合だけ生徒として紐づける
      student: entry.student_id
        ? { id: entry.student_id, name, grade: entry.student?.grade }
        : undefined,
      slotNumber,
      slotTime: formatSlotTime(entry.time_slot ?? slotById.get(entry.time_slot_id)),
      urgency: 'high',
      href: '/schedule',
    });
  }

  return items;
}

// ============================================================
// 2. 生徒アラート × 今日来る生徒
// ============================================================

export interface BuildStudentAlertTodosInput {
  studentAlerts: StudentAlerts[];
  todayStudentIds: Set<string>;
  slotByStudentId: SlotByStudentId;
}

/** アラート1件を「行動が分かる文」に翻訳する。翻訳できない種別は null（＝リストに出さない）。 */
function alertToAction(alert: Alert): { label: string; title: string; note?: string } | null {
  const d = alert.details ?? {};
  switch (alert.alert_type) {
    case 'interview_overdue':
      return {
        label: '面談',
        title: '面談の日程を聞く',
        note: d.days_overdue != null ? `前回面談から${d.days_overdue}日` : alert.message,
      };
    case 'application_overdue':
      return {
        label: '申込',
        title: d.item_name ? `「${d.item_name}」を渡す・回収する` : '申込書を渡す・回収する',
        note: buildDueNote(d.due_date, d.days_until_due),
      };
    case 'interview_task':
      return {
        label: 'タスク',
        title: alert.message,
        note: buildDueNote(undefined, d.days_until_due),
      };
    case 'score_missing':
      return { label: '成績', title: '通知表・テスト結果を見せてもらう', note: alert.message };
    case 'exam_overdue':
      return { label: '模試', title: '模試の目標点と行動目標を決める', note: alert.message };
    case 'homework_not_done':
      return { label: '学習', title: '宿題が続けて未実施。やり方を確認する', note: alert.message };
    case 'tardy':
      return { label: '遅刻', title: '遅刻が続いている。時間を確認する', note: alert.message };
    case 'course_prep_overdue':
      return {
        label: '講習',
        title: d.item_name ? `講習の「${d.item_name}」を進める` : '講習の準備を進める',
        note: buildDueNote(d.due_date, d.days_until_due),
      };
    case 'schedule_change_unapplied':
      return { label: '日程', title: '日程変更が通塾日程に未反映', note: alert.message };
    case 'score_drop':
      return { label: '成績', title: '成績が下がっている。声をかける', note: alert.message };
    // 面談更新は「実施済みの記録」であって用事ではないので出さない
    case 'interview_recent':
      return null;
    default:
      return null;
  }
}

/**
 * 生徒アラートのうち「今日その生徒が教室に来る」ものだけを用事に変える。
 * 来ない日に出しても直接渡す・聞くができず、リストが流れるだけなので突き合わせる。
 */
export function buildStudentAlertTodos(input: BuildStudentAlertTodosInput): TodayTodoItem[] {
  const { studentAlerts, todayStudentIds, slotByStudentId } = input;
  const items: TodayTodoItem[] = [];

  for (const group of studentAlerts) {
    if (!todayStudentIds.has(group.student_id)) continue;
    const slot = slotByStudentId.get(group.student_id);

    for (const alert of group.alerts) {
      const action = alertToAction(alert);
      if (!action) continue;
      const d = alert.details ?? {};
      const overdue =
        (d.days_until_due != null && d.days_until_due < 0) || (d.days_overdue ?? 0) > 0;

      items.push({
        id: `alert:${alert.id}`,
        source: 'student',
        label: action.label,
        title: action.title,
        note: action.note,
        student: {
          id: alert.student_id,
          name: alert.student_name,
          grade: alert.grade,
        },
        slotNumber: slot?.slotNumber,
        slotTime: slot?.slotTime,
        overdue: overdue || undefined,
        urgency: urgencyFromSeverity(alert),
        href: `/students/${alert.student_id}`,
      });
    }
  }

  return items;
}

// ============================================================
// 3. 月次タスク
// ============================================================

export interface BuildTaskTodosInput {
  tasks: ProgressWidgetTask[];
  today: string;
}

/**
 * 業務進捗管理表の当月タスクから「今日が期日」「期限超過」だけを拾う。
 * 未来の予定まで出すと今日の判断材料にならないため絞る。
 */
export function buildTaskTodos(input: BuildTaskTodosInput): TodayTodoItem[] {
  const { tasks, today } = input;

  return tasks
    .filter((t) => t.incompleteSchoolIds.length > 0 && (t.task_date === today || t.overdue))
    .map((task) => {
      const overdueDays = diffDays(task.task_date, today);
      const note = task.overdue
        ? `期限を${overdueDays}日超過`
        : task.task_date === today
          ? '期限: 今日'
          : undefined;

      return {
        id: `task:${task.id}`,
        source: 'task',
        label: 'タスク',
        title: task.task_name,
        note,
        overdue: task.overdue || undefined,
        urgency: task.overdue ? 'high' : 'medium',
        href: '/tasks',
      } satisfies TodayTodoItem;
    });
}

// ============================================================
// 4. 授業報告書
// ============================================================

export interface BuildReportTodosInput {
  /** 未提出（昨日まで）の対象 */
  overdueTargets: OverdueReportTarget[];
  /** 承認待ち件数 */
  pendingCount: number;
}

/**
 * 報告書は件数が多くなりやすいので、1件ずつ出さず「未提出」「承認待ち」の2行に畳む。
 * 誰に催促するかは講師別内訳で分かればよい。
 */
export function buildReportTodos(input: BuildReportTodosInput): TodayTodoItem[] {
  const { overdueTargets, pendingCount } = input;
  const items: TodayTodoItem[] = [];

  if (overdueTargets.length > 0) {
    const countByTeacher = new Map<string, number>();
    for (const t of overdueTargets) {
      const name = t.teacher_name || '担当未設定';
      countByTeacher.set(name, (countByTeacher.get(name) ?? 0) + 1);
    }
    // 件数が多い講師から並べる（先に声をかける相手が上に来るように）
    const sorted = Array.from(countByTeacher.entries()).sort((a, b) => b[1] - a[1]);
    const head = sorted
      .slice(0, 3)
      .map(([name, count]) => `${name}${count}`)
      .join('・');
    const note = sorted.length > 3 ? `${head}ほか` : head;

    items.push({
      id: 'report-overdue',
      source: 'report',
      label: '報告書',
      title: `昨日までの報告書が未提出 ${overdueTargets.length}件`,
      note,
      overdue: true,
      urgency: 'medium',
      href: '/lesson-reports/overdue',
    });
  }

  if (pendingCount > 0) {
    items.push({
      id: 'report-pending',
      source: 'report',
      label: '報告書',
      title: `承認待ちの報告書 ${pendingCount}件を確認する`,
      urgency: 'low',
      href: '/lesson-reports/pending',
    });
  }

  return items;
}

// ============================================================
// 5. 振替期限
// ============================================================

export interface BuildTransferTodosInput {
  /** 振替先が未確定の transferred_out エントリ */
  entries: ScheduleEntry[];
  todayStudentIds: Set<string>;
  slotByStudentId: SlotByStudentId;
  today: string;
}

/**
 * 振替は「本人が教室にいるなら直接候補日を聞ける」が、来ない日は保護者へ連絡になる。
 * 手段が変わるので、今日来る生徒は個別に、来ない生徒はまとめて1件にする。
 */
export function buildTransferTodos(input: BuildTransferTodosInput): TodayTodoItem[] {
  const { entries, todayStudentIds, slotByStudentId, today } = input;
  const items: TodayTodoItem[] = [];
  const offsite: ScheduleEntry[] = [];

  for (const entry of entries) {
    const studentId = entry.student_id;
    if (studentId && todayStudentIds.has(studentId)) {
      const deadline = entry.transfer_deadline ?? undefined;
      const remain = deadline ? diffDays(today, deadline) : undefined;
      const slot = slotByStudentId.get(studentId);
      const name = resolveEntryStudentName(entry);

      const note = deadline
        ? remain == null
          ? undefined
          : remain > 0
            ? `振替期限 ${formatMonthDay(deadline)}（あと${remain}日）`
            : remain === 0
              ? `振替期限 ${formatMonthDay(deadline)}（本日）`
              : `振替期限 ${formatMonthDay(deadline)}（${-remain}日超過）`
        : undefined;

      items.push({
        id: `transfer:${entry.id}`,
        source: 'transfer',
        label: '振替',
        title: `${name}さんに振替の候補日を聞く`,
        note,
        student: { id: studentId, name, grade: entry.student?.grade },
        slotNumber: slot?.slotNumber,
        slotTime: slot?.slotTime,
        overdue: remain != null && remain < 0 ? true : undefined,
        // 残り3日以内・超過は今日中に動かないと消化できなくなる
        urgency: remain != null && remain <= 3 ? 'high' : 'medium',
        href: '/schedule',
      });
    } else {
      offsite.push(entry);
    }
  }

  if (offsite.length > 0) {
    const deadlines = offsite
      .map((e) => e.transfer_deadline)
      .filter((d): d is string => Boolean(d))
      .sort();
    const earliest = deadlines[0];

    items.push({
      id: 'transfer-summary',
      source: 'transfer',
      label: '振替',
      title: `振替期限が近いコマ ${offsite.length}件 — 保護者へ候補日の連絡`,
      note: earliest ? `最短 ${formatMonthDay(earliest)}` : undefined,
      urgency: 'medium',
      href: '/schedule',
    });
  }

  return items;
}

// ============================================================
// 6. 教材の配布待ち
// ============================================================

export interface BuildMaterialTodosInput {
  /** status='delivered'（＝届いているが未配布）の発注 */
  orders: MaterialOrderWithDetails[];
  todayStudentIds: Set<string>;
  slotByStudentId: SlotByStudentId;
}

/**
 * 届いた教材は本人が来る日にしか渡せないので、今日来る生徒のぶんだけ出す。
 * 1冊ごとに行を作ると教材の多い生徒でリストが埋まるため、生徒ごとに1件へ畳む。
 */
export function buildMaterialTodos(input: BuildMaterialTodosInput): TodayTodoItem[] {
  const { orders, todayStudentIds, slotByStudentId } = input;

  const byStudent = new Map<string, { name: string; grade?: number; materials: string[] }>();
  for (const order of orders) {
    const studentId = order.student_id;
    if (!studentId || !todayStudentIds.has(studentId)) continue;

    const name = order.student
      ? `${order.student.last_name}${order.student.first_name}`
      : '（氏名未登録）';
    const entry = byStudent.get(studentId) ?? {
      name,
      grade: order.student?.grade,
      materials: [],
    };
    if (order.material?.name) entry.materials.push(order.material.name);
    byStudent.set(studentId, entry);
  }

  return Array.from(byStudent.entries()).map(([studentId, info]) => {
    const slot = slotByStudentId.get(studentId);
    return {
      id: `material:${studentId}`,
      source: 'material',
      label: '教材',
      title: '発注済みの教材を渡す',
      note: info.materials.length > 0 ? joinWithMore(info.materials, 2, '件') : undefined,
      student: { id: studentId, name: info.name, grade: info.grade },
      slotNumber: slot?.slotNumber,
      slotTime: slot?.slotTime,
      urgency: 'low',
      href: '/ordering',
    } satisfies TodayTodoItem;
  });
}

// ============================================================
// 取得（fetch）
// ============================================================

/** 1本落ちても全体を止めない。失敗したソースは空扱いにしてログだけ残す。 */
function settledOr<T>(result: PromiseSettledResult<T>, fallback: T, label: string): T {
  if (result.status === 'fulfilled') return result.value;
  console.error(`[todayTodos] ${label}の取得に失敗しました`, result.reason);
  return fallback;
}

export interface TodayTodosLightResult {
  items: TodayTodoItem[];
  /** 今日授業がある生徒。Heavy 側の突き合わせにそのまま渡す */
  todayStudentIds: Set<string>;
  slotByStudentId: SlotByStudentId;
}

/**
 * 軽い群。ページを開いてすぐ出す。
 * 当日の座席・Light アラート・月次タスク・振替・教材まで。
 */
export async function fetchTodayTodosLight(
  schoolIds: string[],
  today: string
): Promise<TodayTodosLightResult> {
  if (schoolIds.length === 0) {
    return { items: [], todayStudentIds: new Set(), slotByStudentId: new Map() };
  }

  const [entriesRes, absencesRes, slotsRes, alertsRes, widgetRes, transfersRes, ordersRes] =
    await Promise.allSettled([
      Promise.all(schoolIds.map((id) => getScheduleEntries(id, today, today))).then((r) =>
        r.flat()
      ),
      Promise.all(schoolIds.map((id) => getTeacherAbsences(id, today, today))),
      Promise.all(schoolIds.map((id) => getActiveTimeSlots(id))).then((r) => r.flat()),
      getAlertsLight(schoolIds),
      getProgressWidget(schoolIds),
      getPendingTransfers(schoolIds, 14),
      getOrders(schoolIds, { status: 'delivered' }),
    ]);

  const entries = settledOr(entriesRes, [] as ScheduleEntry[], '当日のスケジュール');
  const absences = settledOr(absencesRes, [] as { keySet: Set<string> }[], '講師欠勤') as {
    keySet: Set<string>;
  }[];
  const timeSlots = settledOr(slotsRes, [] as ScheduleTimeSlot[], 'コマ時間');
  const studentAlerts = settledOr(alertsRes, [] as StudentAlerts[], '生徒アラート（軽）');
  const widget = settledOr(widgetRes, { allComplete: true, tasks: [] }, '月次タスク');
  const transfers = settledOr(transfersRes, [] as ScheduleEntry[], '振替期限');
  const orders = settledOr(ordersRes, [] as MaterialOrderWithDetails[], '教材の発注');

  // 複数校ぶんの欠勤キーを1つの集合にまとめる
  const absenceKeySet = new Set<string>();
  for (const a of absences) for (const k of Array.from(a.keySet)) absenceKeySet.add(k);

  const slotById = new Map(timeSlots.map((s) => [s.id, s]));
  const activeEntries = entries.filter(isActiveEntry);

  // 今日来る生徒と、その生徒が“最初に”来るコマ（同じ生徒が複数コマある場合は早い方に寄せる）
  const todayStudentIds = new Set<string>();
  const slotByStudentId: SlotByStudentId = new Map();
  for (const entry of activeEntries) {
    if (!entry.student_id) continue;
    todayStudentIds.add(entry.student_id);
    const slot = entry.time_slot ?? slotById.get(entry.time_slot_id);
    if (!slot) continue;
    const current = slotByStudentId.get(entry.student_id);
    if (!current || slot.slot_number < current.slotNumber) {
      slotByStudentId.set(entry.student_id, {
        slotNumber: slot.slot_number,
        slotTime: formatSlotTime(slot),
      });
    }
  }

  // 講師名は当日エントリのリレーションから引く（別途 users を叩かない）
  const teacherNameById = new Map<string, string>();
  for (const entry of entries) {
    const t = entry.teacher;
    if (!t?.id) continue;
    teacherNameById.set(t.id, t.display_name || t.last_name || '講師');
  }

  const items = [
    ...buildSeatTodos({ entries, absenceKeySet, timeSlots, teacherNameById, today }),
    ...buildStudentAlertTodos({ studentAlerts, todayStudentIds, slotByStudentId }),
    ...buildTaskTodos({ tasks: widget.tasks ?? [], today }),
    ...buildTransferTodos({ entries: transfers, todayStudentIds, slotByStudentId, today }),
    ...buildMaterialTodos({ orders, todayStudentIds, slotByStudentId }),
  ].sort(compareTodayTodos);

  return { items, todayStudentIds, slotByStudentId };
}

/**
 * 重い群。軽い群を描いたあとに後追いで足す。
 *
 * @param excludeIds Light で既に出した項目のID。Heavy アラートは Light と同じ id 体系
 *                   （`alert:${alert.id}`）なので、重複した行が2回出ないように弾く。
 *                   省略した場合は mergeTodayTodos で落とせる。
 */
export async function fetchTodayTodosHeavy(
  schoolIds: string[],
  today: string,
  todayStudentIds: Set<string>,
  slotByStudentId: SlotByStudentId,
  excludeIds?: Set<string>
): Promise<TodayTodoItem[]> {
  if (schoolIds.length === 0) return [];

  const [alertsRes, overdueRes, pendingRes] = await Promise.allSettled([
    getAlertsHeavy(schoolIds),
    getOverdueReports(schoolIds, 1),
    getPendingReports(schoolIds),
  ]);

  const studentAlerts = settledOr(alertsRes, [] as StudentAlerts[], '生徒アラート（重）');
  const overdueTargets = settledOr(overdueRes, [] as OverdueReportTarget[], '未提出の報告書');
  const pending = settledOr(pendingRes, [] as unknown[], '承認待ちの報告書');

  const items = [
    ...buildStudentAlertTodos({ studentAlerts, todayStudentIds, slotByStudentId }),
    ...buildReportTodos({ overdueTargets, pendingCount: pending.length }),
  ];

  const filtered = excludeIds ? items.filter((i) => !excludeIds.has(i.id)) : items;
  return filtered.sort(compareTodayTodos);
}

/**
 * Light と Heavy の結果を1本にまとめる。
 * 同じ id は必ず同じ用事なので、先に出した方（Light）を残して重複を落とす。
 */
export function mergeTodayTodos(...groups: TodayTodoItem[][]): TodayTodoItem[] {
  const seen = new Set<string>();
  const merged: TodayTodoItem[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged.sort(compareTodayTodos);
}
