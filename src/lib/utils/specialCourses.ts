/**
 * 特別講座（通年講座 / 講習講座）の純粋ロジック。
 *
 * 正典: docs/special-courses-plan.md
 * DB アクセスや React に依存しない計算だけをここに置き、API 層（lib/api/specialCourses.ts）と
 * 画面（/schedule/special-courses・形態ボード）の双方から使う。テストもここに寄せる。
 */
import { GRADE_LABELS } from '@/types/database';

/** 開催予定1回分（配布する予定表そのもの。変更・振替はしない前提） */
export interface SpecialCourseSession {
  date: string; // 'YYYY-MM-DD'
  start_time: string; // 'HH:mm'
  end_time: string; // 'HH:mm'
}

/** 講座の種別。通年講座＝通常期も講習期も開催 / 講習講座＝その講習期だけ */
export type SpecialCourseScope = 'year_round' | 'koushu';

export const SPECIAL_COURSE_SCOPE_LABELS: Record<SpecialCourseScope, string> = {
  year_round: '通年講座',
  koushu: '講習講座',
};

/**
 * 対象学年の表示名。空配列は「全学年」。
 * GRADE_LABELS に無い数値（将来の学年追加など）は数値のまま出して、黙って落とさない。
 */
export function formatTargetGrades(grades: number[]): string {
  if (grades.length === 0) return '全学年';
  return [...grades]
    .sort((a, b) => a - b)
    .map((g) => GRADE_LABELS[g] ?? String(g))
    .join('・');
}

/**
 * 講座の開講単位（学年×科目）の表示名を組み立てる。
 * 例: 学年=[9]・科目='英語' → 「中3 / 英語」、科目なし → 「中3」、学年なし → 「全学年 / 英語」。
 * 講座名そのものは別に表示するので、ここには含めない。
 */
export function formatCourseScopeLabel(grades: number[], subjectName: string | null): string {
  const gradeLabel = formatTargetGrades(grades);
  const subject = subjectName?.trim();
  return subject ? `${gradeLabel} / ${subject}` : gradeLabel;
}

/** 開催予定表の重複判定キー（同一日時の二重登録を弾く） */
export function sessionKey(s: SpecialCourseSession): string {
  return `${s.date}_${s.start_time}_${s.end_time}`;
}

/** Date を "YYYY-MM-DD" にする。toISOString はUTC変換で日付がズレるため使わず、ローカル値から組み立てる。 */
export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 開始日から指定曜日・回数分の開催日を機械的に並べる（一括生成）。
 * 例: 開始日=8/1・曜日=火木・回数=8 → 8月中の火曜木曜を8回分、日付順に並べる。
 * 3650日（約10年）回しても埋まらない場合は打ち切る（曜日未選択などの入力ミス対策）。
 */
export function generateSessionDates(
  startDate: string,
  dows: number[],
  startTime: string,
  endTime: string,
  count: number
): SpecialCourseSession[] {
  if (!startDate || dows.length === 0 || count <= 0) return [];
  const dowSet = new Set(dows);
  const result: SpecialCourseSession[] = [];
  const cur = new Date(startDate + 'T00:00:00');
  for (let guard = 0; guard < 3650 && result.length < count; guard++) {
    if (dowSet.has(cur.getDay())) {
      result.push({ date: toYMD(cur), start_time: startTime, end_time: endTime });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

/**
 * 既存の開催予定に生成結果を足し込む。
 * 同一日時（date+start+end が完全一致）の行は重複登録しない。結果は日付→開始時刻順。
 */
export function mergeSessionDates(
  existing: SpecialCourseSession[],
  generated: SpecialCourseSession[]
): SpecialCourseSession[] {
  const existingKeys = new Set(existing.map(sessionKey));
  const merged = [...existing, ...generated.filter((s) => !existingKeys.has(sessionKey(s)))];
  merged.sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
  return merged;
}

/** 通年講座の講習期上書き（special_course_koushu_overrides の1行） */
export interface SpecialCourseKoushuOverride {
  course_id: string;
  season: string;
  year: number;
  session_dates: SpecialCourseSession[];
}

/**
 * 「この講習期に上書きがあるか」を判定し、実際に使う開催予定を返す。
 *
 * 上書き行が無ければ通常の時間割（曜日×コマ）のまま開催する＝ここでは sessions=[] を返し、
 * 呼び出し側は「通常どおり」と表示する。空配列の上書き行は「その講習期は開催しない」意思表示
 * として扱い、overridden=true・sessions=[] を返す（無指定と区別する）。
 */
export function resolveKoushuOverride(
  overrides: SpecialCourseKoushuOverride[],
  season: string,
  year: number
): { overridden: boolean; sessions: SpecialCourseSession[] } {
  const hit = overrides.find((o) => o.season === season && o.year === year);
  if (!hit) return { overridden: false, sessions: [] };
  return { overridden: true, sessions: hit.session_dates ?? [] };
}

// ============================================================
// 通年講座の定例枠（曜日×コマ）
// ============================================================

/** 曜日ラベル（0=日〜6=土）。special_courses.day_of_week と同じ並び。 */
export const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 定例枠（曜日・コマ）を持つ最小形。
 * lib/api の SpecialCourse 型に依存させないことで、この関数群を DB 抜きでテストできる。
 */
export interface WeeklySlotHolder {
  day_of_week: number | null;
  time_slot_id: string | null;
}

/** コマ時間の表示に必要な最小形（schedule_time_slots の一部）。 */
export interface WeeklySlotTime {
  start_time: string;
  end_time: string;
}

/**
 * 通年講座の定例枠の表示名（例「月 19:10-20:10」）。
 * 曜日・コマのどちらかが未設定なら null を返し、呼び出し側で「未設定」を出す。
 * コマ時間マスタに該当が見つからない場合（無効化されたコマ等）は曜日だけ返して、
 * 設定されている事実を黙って握りつぶさない。
 */
export function formatWeeklySlotLabel(
  dayOfWeek: number | null,
  timeSlotId: string | null,
  slot: WeeklySlotTime | null | undefined
): string | null {
  if (dayOfWeek == null || !timeSlotId) return null;
  const dow = DOW_LABELS[dayOfWeek] ?? String(dayOfWeek);
  if (!slot) return dow;
  return `${dow} ${slot.start_time.slice(0, 5)}-${slot.end_time.slice(0, 5)}`;
}

/**
 * 形態ボードのセル（曜日×コマ）で選べる講座に絞る。
 *
 * 講座は定例の開催曜日・コマを持つので、別の曜日のセルに枠を作れてしまうと
 * 講座の時間割と枠の実際がずれる（中1理A=月19:10 を火曜のセルに置く事故）。
 * 曜日・コマが未設定の講座は、どのセルにも属さない扱いで候補から外す
 * （講座フォームの「未設定だと座席表の枠から選べません」の注記と対）。
 * 元配列の順序は保つ（呼び出し側の並び＝講座名順をそのまま画面に出すため）。
 */
export function filterCoursesForCell<T extends WeeklySlotHolder>(
  courses: T[],
  dayOfWeek: number,
  timeSlotId: string
): T[] {
  return courses.filter((c) => {
    // 曜日・コマを決めていない講座は「時間が決まっていない講座」。どのコマでも選べる。
    //   例) 国理社オンラインライブ … 中1理A は月19:10と決まっている → そのセルだけ
    //       HAL50分 / HAL80分     … 生徒ごとに曜日も時刻も違う      → どのセルでも
    // 片方だけ設定されている中途半端な状態も「未設定」と同じ扱いにする（絞れないため）。
    if (c.day_of_week == null || c.time_slot_id == null) return true;
    return c.day_of_week === dayOfWeek && c.time_slot_id === timeSlotId;
  });
}

/** 単価×回数の合計金額。単価未設定は null（「—」表示にする）。 */
export function totalCourseFee(unitPrice: number | null, sessionCount: number): number | null {
  return unitPrice != null ? unitPrice * sessionCount : null;
}

/**
 * 受講料の数え方。
 * - per_session（既定）… 1回ごと。請求は「単価 × 回数」
 * - monthly           … 月額。回数によらずその月ぶんを1回だけ請求する（HAL）
 *
 * 月額の講座の金額を1回単価として入れると月4〜5回ぶん掛かって4〜5倍請求になるため、
 * 講座ごとにどちらで数えるかを持つ。講習講座は申込コマ数で請求するので常に per_session。
 */
export type CourseBillingUnit = 'per_session' | 'monthly';

/** 受講料の数え方の表示名 */
export const COURSE_BILLING_UNIT_LABELS: Record<CourseBillingUnit, string> = {
  per_session: '1回ごと（単価×回数）',
  monthly: '月額（回数によらず一定）',
};
