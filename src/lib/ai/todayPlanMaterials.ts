import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toSurnameOnly } from '@/lib/utils/teacherName';
import { WORK_START, WORK_END, type PlanMaterials } from '@/lib/ai/todayPlan';

/**
 * 「今日の段取り」の材料を集める（サーバー専用）。
 *
 * 正典: docs/today-plan-ai-plan.md
 *
 * ★材料を増やさない。今日の用事・今日のコマ・この先で授業がある日、だけ。
 *   カレンダーも出勤簿も読まない（勤務は 13:00〜21:30 の既定固定）。
 *   材料が増えるほど、朝の1回で組み切れなくなる。
 *
 * ★生徒・講師は姓のみ。フルネームも連絡先も外へ出さない。
 *
 * ★「今日やること」（src/lib/api/todayTodos.ts）はここから呼べない。
 *   あちらはブラウザ用の supabase クライアントをモジュールの中で掴んでいて、
 *   サーバーでは他人のセッションで動いてしまう。
 *   なので用事は、その日に手が動かせる2つ ——「届いた教材を渡す」と
 *   「期限が近い月次タスク」—— だけをここで引き直す。
 *   作り込みすぎない（材料が増えると、そもそも朝に組み切れない）。
 *
 * ★.limit() を必ず付ける。未ページングの select は1000行で黙って切られる。
 */

/** 引く上限。教室1つ・1日ぶんなので、これで足りる */
const SLOT_LIMIT = 60;
const ENTRY_LIMIT = 300;
const ORDER_LIMIT = 200;
const TASK_LIMIT = 100;
const UPCOMING_LIMIT = 500;
/** 用事は多すぎると置き切れない。上限で切る */
const TODO_LIMIT = 30;
/** この先どこまで見るか（日） */
const UPCOMING_DAYS = 7;

/** 'HH:MM:SS' → 'HH:MM' */
function toHhMm(time: string | null | undefined): string {
  return (time ?? '').slice(0, 5);
}

/** 'YYYY-MM-DD' を n 日ずらす。★UTC固定で計算する（ローカル時刻だと1日ずれる） */
function shiftDate(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return date;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** PostgREST の埋め込みは配列で返ることがある。先頭を採る */
function one<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

/** コマ1つぶん。時間帯の見出しはこれで作る */
export type PlanSlot = PlanMaterials['slots'][number];

/**
 * その教室のコマを引く。
 * ★GET（見出しを出すだけ）と材料集めの両方が使う。時間帯の並びが2か所でずれると、
 *   保存した block が画面のどこにも属さない行になって消えて見える。
 */
export async function fetchPlanSlots(
  supabase: SupabaseClient,
  schoolId: string
): Promise<{ slots: PlanSlot[]; repIdBySlotId: Map<string, string> }> {
  const { data: slotRows } = await supabase
    .from('schedule_time_slots')
    .select('id, slot_number, start_time, end_time')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('start_time', { ascending: true })
    .limit(SLOT_LIMIT);

  /**
   * ★同じコマ番号の行が個別・集団で別々にある（formation ごとに時刻を持てるため）。
   *   そのまま時間帯にすると「3限」が2つ並んで、どちらに置いたか分からなくなる。
   *   コマ番号ごとに1つ（いちばん早く始まるほう）を代表にして、
   *   授業のほうは代表のIDに寄せる。
   */
  const repBySlotNumber = new Map<number, PlanSlot>();
  const repIdBySlotId = new Map<string, string>();
  for (const row of slotRows ?? []) {
    const r = row as { id: string; slot_number: number; start_time: string; end_time: string };
    const existing = repBySlotNumber.get(r.slot_number);
    if (!existing) {
      repBySlotNumber.set(r.slot_number, {
        id: r.id,
        label: `${r.slot_number}限`,
        start: toHhMm(r.start_time),
        end: toHhMm(r.end_time),
      });
    }
    repIdBySlotId.set(r.id, repBySlotNumber.get(r.slot_number)!.id);
  }
  const slots = Array.from(repBySlotNumber.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);

  return { slots, repIdBySlotId };
}

export async function buildPlanMaterials(
  supabase: SupabaseClient,
  schoolId: string,
  date: string
): Promise<PlanMaterials> {
  const { slots, repIdBySlotId } = await fetchPlanSlots(supabase, schoolId);
  const slotIds = new Set(slots.map((s) => s.id));

  /* --------------------------------------------------------
   * 今日の授業（生徒・講師は姓のみ）
   * ------------------------------------------------------ */
  const { data: entryRows } = await supabase
    .from('schedule_entries')
    .select(
      'time_slot_id, status, student:students(last_name), teacher:user_profiles!schedule_entries_teacher_id_fkey(last_name, display_name)'
    )
    .eq('school_id', schoolId)
    .eq('entry_date', date)
    // 取消・振替元はその日には起きない授業なので、置き場所の材料にしない
    .in('status', ['scheduled', 'completed', 'transferred_in'])
    .limit(ENTRY_LIMIT);

  const lessons: PlanMaterials['lessons'] = [];
  const surnameByStudentSeen = new Set<string>();
  for (const row of entryRows ?? []) {
    const r = row as {
      time_slot_id: string;
      student?: { last_name?: string } | { last_name?: string }[];
      teacher?:
        | { last_name?: string | null; display_name?: string | null }
        | { last_name?: string | null; display_name?: string | null }[];
    };
    const slotId = repIdBySlotId.get(r.time_slot_id);
    if (!slotId || !slotIds.has(slotId)) continue;

    const student = one(r.student);
    const studentSurname = (student?.last_name ?? '').trim();
    if (!studentSurname) continue;

    const teacher = one(r.teacher);
    const teacherSurname =
      (teacher?.last_name ?? '').trim() || toSurnameOnly(teacher?.display_name) || undefined;

    // 同じ生徒が同じコマに複数行あることがある（科目ごと）。姓の羅列が長くなるので畳む
    const key = `${slotId}|${studentSurname}`;
    if (surnameByStudentSeen.has(key)) continue;
    surnameByStudentSeen.add(key);

    lessons.push({ slotId, studentSurname, ...(teacherSurname ? { teacherSurname } : {}) });
  }

  /* --------------------------------------------------------
   * 用事1: 届いているのにまだ渡していない教材
   * ------------------------------------------------------ */
  // ★status は 'delivered'（＝現物は届いたが未配布）。'distributed' はもう渡し終わっている
  const { data: orderRows } = await supabase
    .from('material_orders')
    .select('id, student_id, student:students(last_name), material:materials(name)')
    .eq('school_id', schoolId)
    .eq('status', 'delivered')
    .not('student_id', 'is', null)
    .limit(ORDER_LIMIT);

  /** 生徒ごとに1件へ畳む。1冊ずつ行を作ると教材の多い生徒で段取りが埋まる */
  const materialByStudent = new Map<string, { surname: string; names: string[] }>();
  for (const row of orderRows ?? []) {
    const r = row as {
      student_id: string;
      student?: { last_name?: string } | { last_name?: string }[];
      material?: { name?: string } | { name?: string }[];
    };
    const surname = (one(r.student)?.last_name ?? '').trim();
    if (!surname) continue;
    const entry = materialByStudent.get(r.student_id) ?? { surname, names: [] };
    const name = one(r.material)?.name;
    if (name) entry.names.push(name);
    materialByStudent.set(r.student_id, entry);
  }

  const todos: PlanMaterials['todos'] = Array.from(materialByStudent.entries()).map(
    ([studentId, info]) => ({
      id: `material:${studentId}`,
      text:
        info.names.length > 0
          ? `届いた教材を渡す（${info.names.slice(0, 2).join('・')}${info.names.length > 2 ? 'ほか' : ''}）`
          : '届いた教材を渡す',
      studentSurname: info.surname,
    })
  );

  /* --------------------------------------------------------
   * 用事2: 期限が近い月次タスクのうち、この教室でまだ済んでいないもの
   * ------------------------------------------------------ */
  const until = shiftDate(date, UPCOMING_DAYS);
  const { data: taskRows } = await supabase
    .from('monthly_tasks')
    .select('id, task_name, task_date')
    .gte('task_date', date)
    .lte('task_date', until)
    .order('task_date', { ascending: true })
    .limit(TASK_LIMIT);

  const taskIds = (taskRows ?? []).map((t) => (t as { id: string }).id);
  /**
   * ★monthly_tasks は全教室共通のマスタで、済かどうかは monthly_task_checks 側にある。
   *   行が無い＝まだ誰も触っていない＝未済。
   */
  const doneTaskIds = new Set<string>();
  if (taskIds.length > 0) {
    const { data: checkRows } = await supabase
      .from('monthly_task_checks')
      .select('task_id, is_completed')
      .eq('school_id', schoolId)
      .in('task_id', taskIds)
      .limit(TASK_LIMIT);
    for (const row of checkRows ?? []) {
      const c = row as { task_id: string; is_completed: boolean };
      if (c.is_completed) doneTaskIds.add(c.task_id);
    }
  }

  for (const row of taskRows ?? []) {
    const t = row as { id: string; task_name: string; task_date: string };
    if (doneTaskIds.has(t.id)) continue;
    todos.push({ id: `task:${t.id}`, text: t.task_name, due: t.task_date });
  }

  /* --------------------------------------------------------
   * この先で授業がある日
   * ------------------------------------------------------ */
  // ★これが無いと「明日でいいか」を判断できない。授業の登録が無い日に回しても誰もいない
  const { data: upcomingRows } = await supabase
    .from('schedule_entries')
    .select('entry_date')
    .eq('school_id', schoolId)
    .gte('entry_date', shiftDate(date, 1))
    .lte('entry_date', until)
    .in('status', ['scheduled', 'transferred_in'])
    .order('entry_date', { ascending: true })
    .limit(UPCOMING_LIMIT);

  const upcomingLessonDays = Array.from(
    new Set((upcomingRows ?? []).map((r) => (r as { entry_date: string }).entry_date))
  ).sort();

  return {
    date,
    workHours: { start: WORK_START, end: WORK_END },
    slots,
    lessons,
    // ★用事が多すぎると各時間帯4件に収まらず、AIが勝手に落としたものが分からなくなる
    todos: todos.slice(0, TODO_LIMIT),
    upcomingLessonDays,
  };
}
