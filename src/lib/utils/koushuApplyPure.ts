/**
 * 講習申込フォーム（`src/lib/api/koushuApply.ts` のローダー／`src/app/api/koushu-apply/route.ts` の
 * 送信API）から切り出した純粋関数群。
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md 第2部（決定13〜54）。
 * DBクライアント・Node固有APIには一切依存しない。ユニットテスト（koushuApply.test.ts）は
 * このファイルだけを対象にする＝DBに繋がずロジックを検証できるようにするための分離。
 */
import {
  MAX_GRADE_FOR_45MIN,
  type ApplyDuration,
  type ApplyRatio,
  type ApplyAvailabilitySlot,
  type KoushuApplyCourseInput,
  type KoushuApplySubjectInput,
} from '@/types/koushu-apply';

// ============================================================
// 学年・期間
// ============================================================

/**
 * 学年番号(1-13) → 学年カテゴリ。`subjects.grade_category` と対応させる規約。
 * 既存コード（src/lib/api/students.ts の getGradeCategory 等）と同じ境界を踏襲する:
 * 小1-6=elementary / 中1-3=middle / 高1-3・既卒=high。
 */
export function gradeCategoryOf(grade: number): 'elementary' | 'middle' | 'high' {
  if (grade <= 6) return 'elementary';
  if (grade <= 9) return 'middle';
  return 'high';
}

/**
 * 期間の暦上の週数（決定28）。休講週も1週として数える。
 * 終了日が開始日より前など不正な範囲は 0 を返す（呼び出し側で異常値として扱えるように例外は投げない）。
 */
export function calendarWeeks(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days <= 0) return 0;
  return Math.ceil(days / 7);
}

/**
 * 学年別終了日の解決（決定44）。開始日は共通・終了日だけ学年別。
 * 書いていない学年（またはテーブル自体が無い）は schedule_end_date にフォールバックする。
 * jsonb から来る値なのでキーは常に文字列（例 '7'）。
 */
export function resolveGradeEndDate(
  scheduleEndDate: string,
  scheduleEndByGrade: Record<string, string> | null | undefined,
  grade: number
): string {
  const override = scheduleEndByGrade?.[String(grade)];
  return override || scheduleEndDate;
}

/**
 * 申込フォームの公開判定（決定29・§12・§16-1）。
 * 仕様の SQL 定義「apply_publish_start IS NOT NULL AND now() BETWEEN start AND end」に忠実に、
 * start/end のどちらかが NULL なら非公開として扱う（end だけ NULL でも公開扱いにする"緩め"はしない。
 * ここが非公開の担保の要なので絶対に緩めないこと）。
 */
export function isApplyPublished(
  publishStart: string | null | undefined,
  publishEnd: string | null | undefined,
  now: Date
): boolean {
  if (!publishStart || !publishEnd) return false;
  const start = new Date(publishStart).getTime();
  const end = new Date(publishEnd).getTime();
  const t = now.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return t >= start && t <= end;
}

// ============================================================
// 提案（決定32・33・34・47）
// ============================================================

/** 提案書1件ぶんのユニット（コマ数集計の入力） */
export interface ProposalUnitInput {
  groupId: number;
  komaCount: number;
}

/**
 * 提案書1枚（教材1枚）のユニットからコマ数を合計する。
 * `src/lib/api/proposals.ts` の `calcTotalKoma` と同じグルーピング規約:
 * group_id=0 のユニットはそのまま加算、group_id>0（結合グループ）は同じグループ内で
 * 1回だけ加算する（複数単元をまとめて1コマとして提案しているケースの二重計上を防ぐ）。
 */
export function sumProposalUnitsKoma(units: ProposalUnitInput[]): number {
  let total = 0;
  const seen = new Set<number>();
  for (const u of units) {
    if (u.groupId === 0) {
      total += u.komaCount;
    } else if (!seen.has(u.groupId)) {
      seen.add(u.groupId);
      total += u.komaCount;
    }
  }
  return total;
}

/** 科目ごとに合算する前の、提案書1枚ぶんの入力 */
export interface ProposalSubjectInput {
  subjectId: string;
  subjectName: string;
  textbookName: string;
  theme: string | null;
  koma: number;
  ratio: ApplyRatio;
  duration: ApplyDuration;
}

/** 科目単位に合算した提案（regularKoma・unitPrice はDBアクセスが要るため呼び出し側で追加する） */
export interface AggregatedProposalSubject {
  subjectId: string;
  subjectName: string;
  textbookNames: string[];
  theme: string | null;
  proposedKoma: number;
  ratio: ApplyRatio;
  duration: ApplyDuration;
}

/**
 * 同一科目の複数提案書（教材）を1行に合算する（決定34）。
 * コマ数は合算、教材名は列挙（重複除去）、テーマは最初に現れた非空値を採用する（決定47の「テーマは先頭」）。
 * ratio/duration は最初に現れた提案の値を採用する（同一科目内で提案ごとに形式が割れる運用は想定していない。
 * 決定14により提案由来の形式は教室が決め打ちで揃えているはずのため）。
 * 出現順を保つため Map ではなく配列で順序を管理する。
 */
export function aggregateProposalsBySubject(
  rows: ProposalSubjectInput[]
): AggregatedProposalSubject[] {
  const order: string[] = [];
  const map = new Map<string, AggregatedProposalSubject>();
  for (const row of rows) {
    let agg = map.get(row.subjectId);
    if (!agg) {
      agg = {
        subjectId: row.subjectId,
        subjectName: row.subjectName,
        textbookNames: [],
        theme: null,
        proposedKoma: 0,
        ratio: row.ratio,
        duration: row.duration,
      };
      map.set(row.subjectId, agg);
      order.push(row.subjectId);
    }
    agg.proposedKoma += row.koma;
    if (!agg.textbookNames.includes(row.textbookName)) agg.textbookNames.push(row.textbookName);
    if (!agg.theme && row.theme) agg.theme = row.theme;
  }
  return order.map((id) => map.get(id) as AggregatedProposalSubject);
}

// ============================================================
// 通常授業コマ数の差引（決定27・28）
// ============================================================

/**
 * 通塾日程から科目の週回数を数える（決定28）。distinct(曜日×コマ) で数える
 * （`project_schedule_week_count` の数え方に従う。同一コマの複数行は1回として数える）。
 */
export function countWeeklyRegularSlots(
  patterns: Array<{ dayOfWeek: number; timeSlotId: string }>
): number {
  const set = new Set(patterns.map((p) => `${p.dayOfWeek}_${p.timeSlotId}`));
  return set.size;
}

/** 期間中の通常授業コマ数（請求ベース。決定28）= 週回数 × 期間の暦週数 */
export function regularKomaInPeriod(weeklyCount: number, weeks: number): number {
  return weeklyCount * weeks;
}

// ============================================================
// バリデーション
// ============================================================

/** 45分授業を選べるか（決定17）。90分は誰でも選べる。 */
export function isDurationAllowedForGrade(grade: number, duration: ApplyDuration): boolean {
  return duration === 90 || grade <= MAX_GRADE_FOR_45MIN;
}

/** 0以上の整数か（コマ数の検証。決定49により上限は設けない） */
export function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

// ============================================================
// 通塾可能日程（決定15・§9-3）
// ============================================================

/** DB書き込み用の可能表スロット行 */
export interface ShiftSlotRow {
  shift_date: string;
  time_slot: string;
  available: boolean;
}

/**
 * 開講枠の全量ぶん行を作り、×が付いた枠だけ available=false にする（§9-3）。
 * 「行が無い＝未提出」という第1部の意味論を守るため、開講枠は必ず全量書く
 * （選ばれた枠だけを available=true で書くと、未提出の生徒と全○の生徒が区別できなくなる）。
 */
export function buildShiftSlotRows(
  openSlots: ApplyAvailabilitySlot[],
  unavailable: ApplyAvailabilitySlot[]
): ShiftSlotRow[] {
  const unavailableSet = new Set(unavailable.map((s) => `${s.date}_${s.timeSlot}`));
  return openSlots.map((s) => ({
    shift_date: s.date,
    time_slot: s.timeSlot,
    available: !unavailableSet.has(`${s.date}_${s.timeSlot}`),
  }));
}

// ============================================================
// コース（小集団・プログラミング。決定36〜42・45）
// ============================================================

/** seasonal_courses.session_dates の生の1件 */
export interface RawCourseSession {
  date: string;
  start_time: string;
  end_time: string;
}

/** 開催済みフラグ付きの開催回 */
export interface HeldCourseSession {
  date: string;
  startTime: string;
  endTime: string;
  /** 申込時点で開催済み＝参加対象外（決定45） */
  held: boolean;
}

/**
 * 開催予定を「開催済みか」で振り分ける（決定45）。
 * today（'YYYY-MM-DD'）より前の回は開催済み扱い。文字列比較で十分（'YYYY-MM-DD' は辞書順=時系列順）。
 */
export function markHeldSessions(sessions: RawCourseSession[], today: string): HeldCourseSession[] {
  return sessions.map((s) => ({
    date: s.date,
    startTime: s.start_time,
    endTime: s.end_time,
    held: s.date < today,
  }));
}

/** 未開催の回数（決定42・45: 料金 = unitPrice × これ） */
export function remainingSessionCount(sessions: HeldCourseSession[]): number {
  return sessions.filter((s) => !s.held).length;
}

// ============================================================
// 二重送信の冪等化（決定35）
// ============================================================

/** 既存の koushu_enrollments 行から比較用に取り出した最小情報 */
export interface ExistingEnrollmentSnapshot {
  courseId: string | null;
  createdAt: string; // ISO
  komaBySubject: Record<string, { koma: number; ratio: number; duration: number }> | null;
}

/**
 * 10分以内の同一内容の再送信を冪等化するための比較（決定35）。
 * 既存の申込（koushu_enrollments）が「今回のリクエストと同一内容」かつ「全行が時間枠内」であれば、
 * 二重クリック等による同一送信の再試行とみなして true を返す（呼び出し側は書き込みせず成功扱いにする）。
 * 内容が違う、または時間枠外なら false（＝呼び出し側は「既に申込済み」として 409 にする）。
 *
 * 比較対象は科目ベース行（course_id=null）の koma_by_subject と、コース行（course_id!=null）の
 * course_id 集合。koma=0 の科目は保存時に落とされる規約（upsertKoushuEnrollment）のため、
 * リクエスト側も koma>0 だけを比較対象にする。
 */
export function isDuplicateResubmission(
  existing: ExistingEnrollmentSnapshot[],
  request: { subjects: KoushuApplySubjectInput[]; courses: KoushuApplyCourseInput[] },
  nowMs: number,
  windowMs = 10 * 60 * 1000
): boolean {
  if (existing.length === 0) return false;

  const allRecent = existing.every((e) => nowMs - new Date(e.createdAt).getTime() <= windowMs);
  if (!allRecent) return false;

  const subjectRow = existing.find((e) => e.courseId === null);
  const existingSubjects = subjectRow?.komaBySubject ?? {};
  const requestSubjects = request.subjects.filter((s) => s.koma > 0);

  if (Object.keys(existingSubjects).length !== requestSubjects.length) return false;
  for (const s of requestSubjects) {
    const spec = existingSubjects[s.subjectId];
    if (!spec) return false;
    if (spec.koma !== s.koma || spec.ratio !== s.ratio || spec.duration !== s.duration) {
      return false;
    }
  }

  const existingCourseIds = new Set(
    existing.filter((e) => e.courseId !== null).map((e) => e.courseId as string)
  );
  const requestCourseIds = new Set(request.courses.map((c) => c.courseId));
  if (existingCourseIds.size !== requestCourseIds.size) return false;
  // Set のまま for...of すると tsconfig の target(ES3系) で downlevelIteration エラーになるため配列化する。
  for (const id of Array.from(requestCourseIds)) {
    if (!existingCourseIds.has(id)) return false;
  }

  return true;
}
