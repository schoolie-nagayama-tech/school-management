/**
 * 通年講座の「講習期上書き」を週次生成へ反映するための純粋ロジック。
 *
 * 正典: docs/special-courses-plan.md フェーズ2-A
 *
 * ★ このファイルが存在する理由（重要）
 *   週次生成 (generateWeeklySchedule) と同期チェック (getExpectedEntryDetailsFromPatterns) は
 *   「その週に作られるべきコマ」の集合が **完全に一致** していなければならない。
 *   片方だけに抑止条件や追加生成を入れると、同期チェックが「未反映がある」と誤検知して
 *   画面を開くたびに週全体が再生成され、直前の手動移動が巻き戻る（2026-07-13 の実バグと同型）。
 *   そこで「どのパターンをどの日に生成するか」「上書きから何を生成するか」の判断は
 *   すべて本ファイルの planWeeklyEntries に集約し、両者はこの結果をそのまま使う。
 *
 * DB アクセスは一切しない。入力の取得（どのクエリで読むか）は lib/api/schedule.ts 側の責務。
 */
import type { SpecialCourseSession } from '@/lib/utils/specialCourses';

// ============================================================
// 入力の型
// ============================================================

/** 上書き対象になりうる通年講座（special_courses の必要列だけ） */
export interface OverrideCourse {
  id: string;
  /** schedule_formations.key。コマ解決とエントリの formation に使う */
  formation: string;
}

/** 講習期（course_prep_periods の必要列だけ）。上書き行と (season, year) で突き合わせる */
export interface OverridePeriod {
  season: string;
  year: number;
  schedule_start_date: string;
  schedule_end_date: string;
}

/** 上書き1行（special_course_koushu_overrides）。session_dates 空配列は「その期は開催しない」 */
export interface OverrideRow {
  course_id: string;
  season: string;
  year: number;
  session_dates: SpecialCourseSession[] | null;
}

/** コマ時間マスタ（schedule_time_slots）。呼び出し側で is_active=true に絞って渡すこと */
export interface OverrideTimeSlot {
  id: string;
  formation: string;
  /** 'HH:MM' でも 'HH:MM:SS' でもよい（比較は先頭5文字） */
  start_time: string;
}

/**
 * 上書き反映に必要な入力一式。
 * 講座リンク付きのパターンが1件も無い教室では null を渡す＝上書き機構が完全に無効になり、
 * 既存の生成結果と1件も変わらない（本番の現状がこれ）。
 */
export interface SpecialCourseOverrideInput {
  courses: OverrideCourse[];
  periods: OverridePeriod[];
  overrides: OverrideRow[];
  timeSlots: OverrideTimeSlot[];
}

/**
 * 週次生成の入力となる通塾日程パターン。
 * ScheduleRegularPattern がそのまま渡せるよう、使う列だけを緩く定義する。
 */
export interface PlanPattern {
  id: string;
  student_id: string;
  day_of_week: number;
  time_slot_id: string;
  teacher_id: string | null;
  subject_ids: string[];
  seat_label: string | null;
  formation?: string | null;
  ratio?: 1 | 2 | null;
  duration_minutes?: number | null;
  half_position?: 'first' | 'second' | null;
  effective_from?: string | null;
  effective_until?: string | null;
  special_course_id?: string | null;
  created_at?: string | null;
  /** コマ時間マスタとの結合結果。未設定のパターンは生成対象外（既存挙動） */
  time_slot?: { id: string } | null;
}

/** 生成される1コマ分の計画（DB 行そのものではなく、生成・同期チェック共通の中間表現） */
export interface PlannedEntry {
  /** 'regular' = 通塾日程どおり / 'override' = 通年講座の講習期上書き */
  source: 'regular' | 'override';
  date: string;
  timeSlotId: string;
  studentId: string;
  teacherId: string | null;
  subjectIds: string[];
  seatLabel: string | null;
  formation: string;
  kind: 'regular' | 'koushu';
  ratio: 1 | 2;
  durationMinutes: number | null;
  halfPosition: 'first' | 'second' | null;
  /** 由来の枠。override は名簿を決めた枠（同一生徒に複数あれば作成日時が最古のもの） */
  regularPatternId: string;
  /** override のみ講座ID。regular は null */
  specialCourseId: string | null;
}

const DEFAULT_FORMATION = 'individual';

// ============================================================
// 抑止判定（このパターンはこの日付に生成すべきか）
// ============================================================

/**
 * 講座ID → 「上書きが効いている期間」の一覧。
 * 上書き行があるだけで抑止する（session_dates が空でも＝その期は開催しない）。
 */
export type SuppressionIndex = Map<string, Array<{ from: string; to: string }>>;

/**
 * 上書き行と講習期を突き合わせて抑止期間の索引を作る。
 *
 * 期間が引けない上書き行（course_prep_periods に該当 season/year が無い、または
 * 講習期の日程が未設定）は、いつからいつまで抑止すべきか決められないので無視する。
 * 「日付が分からないのに通常の生成を止める」方が事故が大きいため、通常どおり生成に倒す。
 */
export function buildSuppressionIndex(input: SpecialCourseOverrideInput | null): SuppressionIndex {
  const index: SuppressionIndex = new Map();
  if (!input) return index;
  const courseIds = new Set(input.courses.map((c) => c.id));
  for (const o of input.overrides) {
    if (!courseIds.has(o.course_id)) continue;
    const period = input.periods.find((p) => p.season === o.season && p.year === o.year);
    if (!period || !period.schedule_start_date || !period.schedule_end_date) continue;
    const list = index.get(o.course_id) ?? [];
    list.push({ from: period.schedule_start_date, to: period.schedule_end_date });
    index.set(o.course_id, list);
  }
  return index;
}

/** その講座がその日付で抑止されているか（＝定期の枠から生成してはいけないか） */
export function isSuppressedOnDate(
  index: SuppressionIndex,
  courseId: string | null | undefined,
  date: string
): boolean {
  if (!courseId) return false;
  const ranges = index.get(courseId);
  if (!ranges) return false;
  return ranges.some((r) => r.from <= date && date <= r.to);
}

// ============================================================
// コマ解決・名簿解決
// ============================================================

/** 'HH:MM:SS' も 'HH:MM' も 'HH:MM' に揃える（DB は time 型で秒つきで返る） */
export function normalizeTimeHHMM(time: string): string {
  return (time ?? '').slice(0, 5);
}

/**
 * 上書き session の開始時刻から、その形態のコマを **完全一致** で引く。
 *
 * 部分一致や最も近いコマへの寄せはしない：ズレたコマに落とすと座席表の見た目は
 * 正しいのに実際の時間割と食い違い、現場では気づけないため。一致が無ければ生成しない
 * （UI 側で保存時に行単位の警告を出すのが主対策）。
 */
export function resolveOverrideTimeSlotId(
  timeSlots: OverrideTimeSlot[],
  formation: string,
  startTime: string
): string | null {
  const target = normalizeTimeHHMM(startTime);
  const hit = timeSlots.find(
    (s) => s.formation === formation && normalizeTimeHHMM(s.start_time) === target
  );
  return hit?.id ?? null;
}

/**
 * 開催予定のうち「コマ時間に一致する開始時刻が無い」行を返す（0始まりの index つき）。
 *
 * 上書き登録UIの保存時警告に使う。生成側の resolveOverrideTimeSlotId をそのまま通すので、
 * 「警告が出た行＝座席表に生成されない行」が定義上ズレない。
 */
export function findSessionsWithoutTimeSlot(
  sessions: SpecialCourseSession[],
  timeSlots: OverrideTimeSlot[],
  formation: string
): Array<{ index: number; session: SpecialCourseSession }> {
  const result: Array<{ index: number; session: SpecialCourseSession }> = [];
  sessions.forEach((session, index) => {
    if (!session?.start_time) return;
    if (resolveOverrideTimeSlotId(timeSlots, formation, session.start_time) === null) {
      result.push({ index, session });
    }
  });
  return result;
}

/**
 * その日に有効な、講座の名簿（生徒1名につき1枠）。
 *
 * 同じ生徒が同じ講座に複数枠を持つ場合（曜日違いのクラスを掛け持ちなど）は
 * **作成日時が最古の枠** を採用する。講師・科目・座席を決定的に選ぶためで、
 * 実行のたびに担当が入れ替わるのを防ぐ。created_at が同値・欠損のときは id 昇順。
 */
export function resolveOverrideRoster(patterns: PlanPattern[], courseId: string, date: string) {
  const byStudent = new Map<string, PlanPattern>();
  for (const p of patterns) {
    if (p.special_course_id !== courseId) continue;
    if (p.effective_from && date < p.effective_from) continue;
    if (p.effective_until && date > p.effective_until) continue;
    const current = byStudent.get(p.student_id);
    if (!current || comparePatternAge(p, current) < 0) byStudent.set(p.student_id, p);
  }
  return Array.from(byStudent.values()).sort((a, b) => a.student_id.localeCompare(b.student_id));
}

/** 古い枠が先に来る並び。created_at 未設定は「最も新しい」扱いにして id で決着させる */
function comparePatternAge(a: PlanPattern, b: PlanPattern): number {
  const ca = a.created_at ?? '';
  const cb = b.created_at ?? '';
  if (ca && cb && ca !== cb) return ca < cb ? -1 : 1;
  if (ca && !cb) return -1;
  if (!ca && cb) return 1;
  return a.id.localeCompare(b.id);
}

// ============================================================
// 週の計画（生成と同期チェックの唯一の正典）
// ============================================================

/** 週の月曜から7日分の日付と曜日番号。既存の生成ロジックと同じ UTC 起点の刻み方に揃える */
export function weekDaysOf(weekStartDate: string): Array<{ date: string; dow: number }> {
  const weekStart = new Date(weekStartDate);
  const days: Array<{ date: string; dow: number }> = [];
  for (let d = 0; d < 7; d++) {
    const dDate = new Date(weekStart);
    dDate.setUTCDate(weekStart.getUTCDate() + d);
    days.push({ date: dDate.toISOString().slice(0, 10), dow: dDate.getUTCDay() });
  }
  return days;
}

/** 「同一コマ・同一生徒」の占有キー。生成スキップ判定・同期チェックの期待キーと同じ形 */
export function plannedEntryKey(e: {
  date: string;
  timeSlotId: string;
  studentId: string;
}): string {
  return `${e.date}-${e.timeSlotId}-${e.studentId}`;
}

/** 生成の重複除去キー。同一コマでも講師が違えば別行になる既存仕様を保つ（teacher NULL 同士の衝突も回避） */
function regularDedupeKey(e: PlannedEntry): string {
  return `${e.date}-${e.timeSlotId}-${e.teacherId ?? 'null'}-${e.studentId}`;
}

export interface PlanWeeklyEntriesInput {
  /** 週の月曜 'YYYY-MM-DD' */
  weekStartDate: string;
  /** is_active な通塾日程パターン全件（週内で effective が切り替わるため日ごとに判定する） */
  patterns: PlanPattern[];
  /** 生徒ID → 退塾予定日。その日以降は生成しない */
  withdrawalDates: Map<string, string>;
  /** 講習期上書きの入力。null＝上書き機構を使わない（講座リンク付きパターンが0件のとき） */
  override?: SpecialCourseOverrideInput | null;
}

/**
 * その週に生成されるべきコマを列挙する。
 *
 * 生成 (generateWeeklySchedule) はこの結果を schedule_entries の行に写し、
 * 同期チェック (getExpectedEntryDetailsFromPatterns) はこの結果のキー集合を期待値に使う。
 * 両者が同じ入力からこの関数を呼ぶ限り、期待と生成は定義上ズレない。
 *
 * なお「既存行があるコマは作らない」「振替元・キャンセルの枠は避ける」といった
 * DB の現況に依存する除外はここでは行わない（生成側の責務）。同期チェック側は
 * 逆にそれらを covered 判定で吸収するため、ここで落としてしまうと意味論がズレる。
 */
export function planWeeklyEntries(input: PlanWeeklyEntriesInput): PlannedEntry[] {
  const { weekStartDate, patterns, withdrawalDates } = input;
  const override = input.override ?? null;
  const days = weekDaysOf(weekStartDate);
  const suppression = buildSuppressionIndex(override);

  // --- 1) 通塾日程どおりの生成（既存ロジック。抑止判定だけが新規） ---
  const regularMap = new Map<string, PlannedEntry>();
  for (const p of patterns) {
    // コマ時間マスタ未設定のパターンだけスキップ。teacher_id NULL は「担当未決定」として生成する
    if (!p.time_slot) continue;
    for (const { date, dow } of days) {
      if (dow !== p.day_of_week) continue;
      if (p.effective_from && date < p.effective_from) continue;
      if (p.effective_until && date > p.effective_until) continue;
      const wd = withdrawalDates.get(p.student_id);
      if (wd && date >= wd) continue;
      // 講習期の上書きがある講座の枠は、その期間だけ定期の生成を止める
      if (isSuppressedOnDate(suppression, p.special_course_id, date)) continue;
      const e: PlannedEntry = {
        source: 'regular',
        date,
        timeSlotId: p.time_slot_id,
        studentId: p.student_id,
        teacherId: p.teacher_id,
        subjectIds: p.subject_ids || [],
        seatLabel: p.seat_label || null,
        formation: p.formation ?? DEFAULT_FORMATION,
        kind: 'regular',
        ratio: p.ratio ?? 2,
        durationMinutes: p.duration_minutes ?? null,
        halfPosition: p.half_position ?? null,
        regularPatternId: p.id,
        specialCourseId: null,
      };
      regularMap.set(regularDedupeKey(e), e);
    }
  }
  const planned = Array.from(regularMap.values());

  if (!override) return planned;

  // --- 2) 上書きからの生成 ---
  // 定期の枠が既に押さえているコマ（date-slot-student）には上書き分を足さない。
  // 上書きが効いている期間なら定期側は抑止済みなので、ここに来るのは
  // 「上書き期間外に日付を打った」等の入力事故のケース。既存行を尊重して足さない。
  const occupied = new Set(planned.map(plannedEntryKey));
  const weekFrom = days[0].date;
  const weekTo = days[days.length - 1].date;

  for (const course of override.courses) {
    for (const row of override.overrides) {
      if (row.course_id !== course.id) continue;
      for (const session of row.session_dates ?? []) {
        if (!session?.date || !session.start_time) continue;
        if (session.date < weekFrom || session.date > weekTo) continue;
        const timeSlotId = resolveOverrideTimeSlotId(
          override.timeSlots,
          course.formation,
          session.start_time
        );
        if (!timeSlotId) {
          // コマ時間マスタに一致する開始時刻が無い＝座席表のどこにも置けない。
          // 黙って落とすと原因が追えないので警告だけ残す（主対策は登録UIの保存時警告）。
          console.warn(
            `[特別講座] 上書きの開始時刻に一致するコマがありません: course=${course.id} formation=${course.formation} ${session.date} ${session.start_time}`
          );
          continue;
        }
        for (const p of resolveOverrideRoster(patterns, course.id, session.date)) {
          const wd = withdrawalDates.get(p.student_id);
          if (wd && session.date >= wd) continue;
          const e: PlannedEntry = {
            source: 'override',
            date: session.date,
            timeSlotId,
            studentId: p.student_id,
            teacherId: p.teacher_id,
            subjectIds: p.subject_ids || [],
            seatLabel: p.seat_label || null,
            formation: course.formation,
            kind: 'koushu',
            ratio: p.ratio ?? 2,
            durationMinutes: p.duration_minutes ?? null,
            halfPosition: p.half_position ?? null,
            regularPatternId: p.id,
            specialCourseId: course.id,
          };
          const key = plannedEntryKey(e);
          if (occupied.has(key)) continue;
          occupied.add(key);
          planned.push(e);
        }
      }
    }
  }

  return planned;
}
