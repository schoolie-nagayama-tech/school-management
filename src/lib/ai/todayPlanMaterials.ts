import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toSurnameOnly } from '@/lib/utils/teacherName';
import { listCalendarEvents } from '@/lib/google-calendar';
import {
  MAX_CALENDAR_TITLE_LENGTH,
  WORK_START,
  WORK_END,
  selectPlanTodos,
  type PlanCalendarEvent,
  type PlanMaterials,
  type PlanTodo,
} from '@/lib/ai/todayPlan';

/**
 * 「今日の段取り」の材料を集める（サーバー専用）。
 *
 * 正典: docs/today-plan-ai-plan.md
 *
 * ★用事はここで集めない。画面の「今日やること」（TodayTodosWidget）が持っているものを
 *   そのまま受け取る（2026-09-09 変更）。
 *   以前はサーバーで material_orders と monthly_tasks を引き直していたが、
 *   同じ画面の上（段取り）と下（今日やること）で違う用事が並び、
 *   どちらが正しいのか分からなくなっていた。集めるのは1か所だけにする。
 *
 * ここで集めるのは、画面が持っていないものだけ:
 *   コマ・今日の授業・この先で授業がある日・教室長のGoogleカレンダー。
 *
 * ★生徒・講師は姓のみ。フルネームも連絡先も外へ出さない。
 *
 * ★カレンダーが読めなくても段取りは組めること。未連携・取得失敗は握って空にする
 *   （カレンダーのせいで1日の段取りが作れなくなるほうが困る）。
 *
 * ★.limit() を必ず付ける。未ページングの select は1000行で黙って切られる。
 */

/** 引く上限。教室1つ・1日ぶんなので、これで足りる */
const SLOT_LIMIT = 60;
const ENTRY_LIMIT = 300;
const UPCOMING_LIMIT = 500;
/** カレンダーの予定は多くても数件。並べすぎると段取りが予定表になる */
const CALENDAR_LIMIT = 20;
/** この先どこまで見るか（日） */
const UPCOMING_DAYS = 7;

/** 'HH:MM:SS' → 'HH:MM' */
function toHhMm(time: string | null | undefined): string {
  return (time ?? '').slice(0, 5);
}

/**
 * ISO日時 → 日本時間の 'HH:MM'。
 * ★タイムゾーンを固定する。サーバーはUTCで動くので、素の getHours() では9時間ずれる。
 */
function toJstHhMm(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(t));
}

/**
 * その日のカレンダーの予定を読む。
 *
 * ★何があっても投げない。未連携・トークン切れ・APIの不調はすべて空で返す
 *   （カレンダーが読めないだけで段取りが組めなくなってはいけない）。
 *
 * ★終日の予定は外す。時間帯が決まらないので「この時間は空けておく」に使えず、
 *   00:00〜23:59 として渡すと1日ぶんの用事が全部行き場を失う。
 */
async function fetchCalendar(userId: string, date: string): Promise<PlanCalendarEvent[]> {
  if (!userId) return [];
  try {
    // 教室は日本時間で動く。UTCで切ると前日・翌日の予定が混ざる
    const res = await listCalendarEvents(
      userId,
      `${date}T00:00:00+09:00`,
      `${date}T23:59:59+09:00`
    );
    if (!res.success || !res.events) return [];

    const out: PlanCalendarEvent[] = [];
    for (const ev of res.events) {
      if (out.length >= CALENDAR_LIMIT) break;
      if (ev.allDay) continue;
      const start = toJstHhMm(ev.start);
      const end = toJstHhMm(ev.end);
      if (!start || !end) continue;
      out.push({
        start,
        end,
        // ★タイトルはそのまま渡す（教室長自身の予定。長さだけ抑える）
        title: (ev.summary || '(無題)')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, MAX_CALENDAR_TITLE_LENGTH),
      });
    }
    return out;
  } catch (e) {
    console.error('[todayPlanMaterials] カレンダーを読めませんでした', e);
    return [];
  }
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

/**
 * 段取りの材料を組み立てる。
 *
 * @param todos 画面の「今日やること」。★APIが検めたもの（sanitizePlanTodos）を渡す
 * @param userId 教室長本人。Googleカレンダーのトークンは個人に紐づく
 */
export async function buildPlanMaterials(
  supabase: SupabaseClient,
  schoolId: string,
  date: string,
  todos: readonly PlanTodo[],
  userId: string
): Promise<PlanMaterials> {
  // カレンダーは外部APIで遅い。DBを引いている間に走らせておく（結果は下で待つ）
  const calendarPromise = fetchCalendar(userId, date);

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
   * 教室長のカレンダー（面談・来客など）
   * ------------------------------------------------------ */
  const calendar = await calendarPromise;

  /* --------------------------------------------------------
   * この先で授業がある日
   * ------------------------------------------------------ */
  const until = shiftDate(date, UPCOMING_DAYS);
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
    // ★用事が多すぎると各時間帯4件に収まらない。切るときは重要でないものから
    todos: selectPlanTodos(todos),
    calendar,
    upcomingLessonDays,
  };
}
