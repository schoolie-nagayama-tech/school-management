/**
 * 授業報告書フォームの日付・カウントダウン計算（純関数）
 *
 * ここに集めているのは「画面から切り離して単体テストできる計算」だけ。
 * DOM も Supabase も触らない。UI 側（/lesson-reports/[scheduleEntryId]）は
 * この関数群の結果を描画するだけにして、境界（当日・期限切れ・目標なし・
 * 次回授業日なし）の挙動をテストで固定する。
 *
 * 日付はすべて 'YYYY-MM-DD' の文字列で扱う。
 * Date の月跨ぎ・DST でズレないよう、内部では必ず正午（T12:00:00Z）に
 * アンカーしてから日数を計算する。
 */

/** 'YYYY-MM-DD' → UTC正午の epoch ms（日付計算の基準点） */
function anchor(date: string): number {
  return Date.parse(`${date}T12:00:00Z`);
}

/** d1 - d2 の日数差（正なら d1 が後）。不正な日付は null */
export function diffDays(d1: string, d2: string): number | null {
  const t1 = anchor(d1);
  const t2 = anchor(d2);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return null;
  return Math.round((t1 - t2) / 86400000);
}

/** date を n 日進めた 'YYYY-MM-DD'（n が負なら戻す） */
export function addDays(date: string, n: number): string {
  const t = anchor(date);
  if (Number.isNaN(t)) return date;
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

/**
 * 「今日」を JST(UTC+9) で求める。
 * サーバー/ブラウザのタイムゾーンに依らず日本の日付を返したいので、
 * UTC に +9h してから日付部分だけを取り出す。
 */
export function todayInJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────
// 期日カウントダウン
// ─────────────────────────────────────────────

export interface ExamCountdown {
  /** 試験日までの日数。当日=0、過ぎていれば負 */
  daysLeft: number;
  /** 概算の週数（14日→2週間）。切り捨て。期限切れ時は0 */
  weeksLeft: number;
  /** 今日〜試験日までに残っている授業の回数 */
  lessonsLeft: number;
  /** 試験日を過ぎているか（過ぎていれば「期限切れ」表示に切り替える） */
  expired: boolean;
}

/**
 * 試験日までの「あと◯日（◯週間）・授業あと◯回」を求める。
 *
 * - 試験目標が無い（examDate が空）生徒は null を返す＝カウントダウンを出さない。
 * - 授業回数は呼び出し側が渡した予定日一覧（schedule_entries の status='scheduled'）を
 *   今日〜試験日で数える。当日ちょうどの授業・試験当日の授業も「残り」に含める。
 * - 試験日を過ぎている場合は expired=true とし、残り授業は数えない（0）。
 */
export function computeExamCountdown(params: {
  examDate: string | null | undefined;
  /** 基準日（JST の今日）。'YYYY-MM-DD' */
  today: string;
  /** 生徒の授業予定日一覧 'YYYY-MM-DD'（重複可・順不同） */
  lessonDates: string[];
}): ExamCountdown | null {
  const { examDate, today, lessonDates } = params;
  if (!examDate) return null;
  const daysLeft = diffDays(examDate, today);
  if (daysLeft === null) return null;

  const expired = daysLeft < 0;
  // 期限切れの試験で「授業あと◯回」を出すと意味が無いので数えない
  const lessonsLeft = expired
    ? 0
    : lessonDates.filter((d) => !!d && d >= today && d <= examDate).length;

  return {
    daysLeft,
    weeksLeft: expired ? 0 : Math.floor(daysLeft / 7),
    lessonsLeft,
    expired,
  };
}

/** カウントダウンの表示文字列（例: 「あと14日（2週間）」「期限切れ」「今日」） */
export function formatCountdownDays(cd: ExamCountdown): string {
  if (cd.expired) return `期限切れ（${Math.abs(cd.daysLeft)}日前）`;
  if (cd.daysLeft === 0) return 'あと0日（今日）';
  return cd.weeksLeft >= 1 ? `あと${cd.daysLeft}日（${cd.weeksLeft}週間）` : `あと${cd.daysLeft}日`;
}

// ─────────────────────────────────────────────
// 次回までの宿題（日割り）
// ─────────────────────────────────────────────

/**
 * 日割り行を出しすぎないための上限。
 * 長期休みを挟むと次回授業日が1ヶ月先になることがあり、そのまま日付行を作ると
 * 数十行の空欄が並んで逆に入力しづらい。上限で打ち切りつつ、次回授業日の行だけは
 * 必ず最後に残す（「次回授業日までに何をやるか」が見えなくなるのを防ぐ）。
 */
export const MAX_HOMEWORK_ROWS = 21;

/**
 * 次回授業日までの日割り行の日付を生成する。
 *
 * 決めた挙動（テストで固定）:
 * - 対象は「今日の授業の翌日」〜「次回授業日」（次回授業日の行も出す＝入力は任意）。
 * - 次回授業日が取れない / 授業日以前しか無い場合は、翌日から fallbackDays(既定7)日分に
 *   フォールバックする（次回が分からなくても1週間ぶんは書けるようにする）。
 * - 期間が MAX_HOMEWORK_ROWS を超える場合は先頭 MAX_HOMEWORK_ROWS-1 日 + 次回授業日の行。
 */
export function buildHomeworkDateRows(params: {
  /** 今日の授業日 'YYYY-MM-DD' */
  lessonDate: string;
  /** 次回授業日 'YYYY-MM-DD'（無ければ null） */
  nextLessonDate: string | null | undefined;
  fallbackDays?: number;
}): string[] {
  const { lessonDate, nextLessonDate, fallbackDays = 7 } = params;
  if (!lessonDate || Number.isNaN(anchor(lessonDate))) return [];

  const start = addDays(lessonDate, 1);
  // 次回授業日が授業日より後にある場合だけ終端として採用する。
  // （過去日や同日が入っていたらフォールバックに落とす）
  const hasNext = !!nextLessonDate && nextLessonDate >= start;
  const end = hasNext ? (nextLessonDate as string) : addDays(lessonDate, fallbackDays);

  const span = diffDays(end, start);
  if (span === null || span < 0) return [];

  const dates: string[] = [];
  for (let i = 0; i <= span; i++) dates.push(addDays(start, i));

  if (dates.length <= MAX_HOMEWORK_ROWS) return dates;
  // 上限超過: 先頭ぶん + 最終日（＝次回授業日）を必ず残す
  return [...dates.slice(0, MAX_HOMEWORK_ROWS - 1), dates[dates.length - 1]];
}

export interface HomeworkRow {
  date: string;
  text: string;
}

/**
 * 生成した日付行に、既存の宿題テキストを日付一致でマージする。
 * 既存にしか無い日付（授業日がずれた等）は末尾に残して、書いた内容を消さない。
 */
export function mergeHomeworkRows(dates: string[], existing: HomeworkRow[]): HomeworkRow[] {
  const byDate = new Map<string, string>();
  for (const e of existing) {
    if (e.date) byDate.set(e.date, e.text);
  }
  const rows = dates.map((d) => ({ date: d, text: byDate.get(d) ?? '' }));
  const known = new Set(dates);
  // 生成範囲外の既存入力（空でないものだけ）を落とさずに残す
  for (const e of existing) {
    if (e.date && !known.has(e.date) && e.text.trim()) rows.push({ date: e.date, text: e.text });
  }
  return rows;
}

/** 保存前の整形: 空欄の日は保存しない（DBに空行を溜めない） */
export function compactHomeworkRows(rows: HomeworkRow[]): HomeworkRow[] {
  return rows.filter((r) => r.text.trim() !== '').map((r) => ({ date: r.date, text: r.text.trim() }));
}

// ─────────────────────────────────────────────
// 確認テストの合否自動判定
// ─────────────────────────────────────────────

/** 合格ライン（正答率）。7/10=合格・6/10=不合格 という運用に合わせて 70%。 */
export const CHECK_TEST_PASS_RATIO = 0.7;

/**
 * 確認テストの合否を得点から自動判定する（講師が合否ボタンを押さなくて済むように）。
 * 点数・満点のどちらかが未入力、または満点が0以下なら判定不能で null。
 */
export function judgeCheckTestPassed(
  score: number | null | undefined,
  total: number | null | undefined
): boolean | null {
  if (score == null || total == null) return null;
  if (!Number.isFinite(score) || !Number.isFinite(total) || total <= 0) return null;
  return score / total >= CHECK_TEST_PASS_RATIO;
}
