/**
 * 面談ワークスペース共有ロジック
 * ------------------------------------------------------------------
 * ページ本体・左右カラム・印刷シートの複数コンポーネントから参照する
 * 純粋関数・型・定数をここにまとめる（ロジックの二重実装を防ぐため）。
 */

import type {
  AssessmentWithScores,
  CurriculumItemWithProgress,
  StudentTextbookWithDetails,
} from '@/types/database';
import { ASSESSMENT_NAME_LABELS, SEASON_LABELS, SUBJECT_LABELS } from '@/types/database';
import type { ScheduleRegularPattern } from '@/types/schedule';
import { DAY_OF_WEEK_LABELS } from '@/types/schedule';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';

/* ============================================================
 * 日付ユーティリティ
 * ========================================================== */

/** 今日を基準とした経過日数（'YYYY-MM-DD' 文字列同士の日数差） */
export function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  const today = new Date();
  d.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - d.getTime()) / 86400000);
}

/** 'YYYY-MM-DD' を '2026/7/10（金）' 形式にする（InterviewList.formatDate と同じ表記） */
export function fmtDateJa(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const dow = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  return `${y}/${m}/${d}（${dow}）`;
}

/* ============================================================
 * 前回の申し送り抽出
 * ========================================================== */

/**
 * 面談本文から「## 次回への申し送り」見出しセクションを抜き出す純粋関数。
 *
 * 面談記録はNotta（文字起こし）取込やモーダル編集で自由記述されるが、本文中に
 * `## 次回への申し送り` という見出しが書かれていれば、次回の面談時に左カラムの
 * 「前回の申し送り」ピン留めカードへ表示するため、この見出し以降〜次の `##` 見出し
 *（無ければ末尾）までを取り出す。
 *
 * 見出しが見つからない場合は null を返す。呼び出し側で「本文の先頭200字」等に
 * フォールバックさせる想定（申し送りを書く運用が徹底されていない過去記録にも配慮）。
 */
export function extractHandover(content: string): string | null {
  const heading = '## 次回への申し送り';
  const idx = content.indexOf(heading);
  if (idx === -1) return null;

  const afterHeading = content.slice(idx + heading.length);
  // 次の見出し（改行 + "## "）が来たらそこで打ち切る。無ければ末尾まで。
  const nextHeadingOffset = afterHeading.search(/\n##\s/);
  const excerpt =
    nextHeadingOffset === -1 ? afterHeading : afterHeading.slice(0, nextHeadingOffset);
  const trimmed = excerpt.trim();
  return trimmed || null;
}

/* ============================================================
 * 進行表サマリ
 * ========================================================== */

export interface TextbookProgressSummary {
  id: string;
  name: string;
  subject: string;
  total: number;
  done: number;
  progressPct: number;
  stalled: boolean;
  lastDate: string | null;
}

/**
 * 進行表1テキスト分の進捗集計。
 *
 * newProgress.shared.ts の progressStats/isStalled と同じ意味論（最終指導日から14日超で停滞）を
 * getStudentProgress() が返す CurriculumItemWithProgress[] に対して計算し直したもの。
 * 面談ページは生徒単体のテキスト一覧から取得する経路（進行表ページはテキスト一覧を通塾ボードと
 * 一括取得する経路）が異なるため、関数自体は共有せずここで同じロジックを再実装している。
 * 停滞判定のしきい値（14日）を変える場合は newProgress.shared.ts の isStalled も合わせて直すこと。
 */
export function summarizeTextbookProgress(
  textbook: StudentTextbookWithDetails,
  rows: CurriculumItemWithProgress[]
): TextbookProgressSummary {
  const total = rows.length;
  const done = rows.filter((r) => (r.progress?.lessons || []).some((l) => l.lesson_date)).length;

  let lastDate: string | null = null;
  for (const r of rows) {
    for (const l of r.progress?.lessons || []) {
      if (l.lesson_date && (!lastDate || l.lesson_date > lastDate)) lastDate = l.lesson_date;
    }
  }
  const stalled = lastDate != null && daysSince(lastDate) > 14;

  return {
    id: textbook.id,
    name: textbook.textbook?.name ?? '（不明な教材）',
    subject: textbook.textbook?.subject ?? '',
    total,
    done,
    progressPct: total > 0 ? Math.round((done / total) * 100) : 0,
    lastDate,
    stalled,
  };
}

/** 進行表パネル・印刷シートで使う「直近の単元履歴」1件分 */
export interface TextbookLessonHistoryEntry {
  lessonDate: string;
  unitTitle: string;
  teacherName: string | null;
  /** その単元の引継ぎメモ（無ければ null。空文字は null 扱いにする） */
  handover: string | null;
}

/** 進行表パネル・印刷シートで使うテキスト1件分の詳細（進捗集計＋履歴＋次単元＋宿題/遅刻件数） */
export interface TextbookProgressDetail extends TextbookProgressSummary {
  /** 直近の単元履歴。最大5件・実施日の新しい順 */
  recentLessons: TextbookLessonHistoryEntry[];
  /** 次にやる単元名（レッスンが1件も記録されていない単元のうち先頭2件、カリキュラム順） */
  nextUnitTitles: string[];
  /** 宿題未実施が立っている単元数（0件なら呼び出し側で非表示にする） */
  homeworkNotDoneCount: number;
  /** 遅刻が立っている単元数（0件なら呼び出し側で非表示にする） */
  tardyCount: number;
}

/**
 * 進行表パネル向けの詳細集計。summarizeTextbookProgress の進捗集計に加えて、
 * 面談で話題にしやすい「直近何をやったか」「次に何をやるか」「宿題・遅刻の状況」をまとめる。
 *
 * 引継ぎ・宿題未実施・遅刻は student_progress（テキスト×単元）側のフィールドで、
 * 授業セッション記録と非同期に保存される仕様のため、実際には入っていないことが多い。
 * 呼び出し側は 0件・null のときに「0回」「引継ぎなし」を並べず、何も出さないこと
 * （[[project_progress_handover_decoupling]] 参照）。
 */
export function summarizeTextbookDetail(
  textbook: StudentTextbookWithDetails,
  rows: CurriculumItemWithProgress[]
): TextbookProgressDetail {
  const base = summarizeTextbookProgress(textbook, rows);

  // 全単元のレッスンをフラット化して実施日の新しい順に並べ、先頭5件を「直近の単元履歴」とする。
  // teacher_name はレッスン行に無ければ進行記録側（progress.teacher_name）にフォールバックする。
  const flatLessons: TextbookLessonHistoryEntry[] = [];
  for (const item of rows) {
    for (const lesson of item.progress?.lessons ?? []) {
      if (!lesson.lesson_date) continue;
      flatLessons.push({
        lessonDate: lesson.lesson_date,
        unitTitle: item.title,
        teacherName: lesson.teacher_name ?? item.progress?.teacher_name ?? null,
        handover: item.progress?.handover?.trim() || null,
      });
    }
  }
  flatLessons.sort((a, b) => b.lessonDate.localeCompare(a.lessonDate));
  const recentLessons = flatLessons.slice(0, 5);

  // 次にやる単元 = レッスンが1件も記録されていない単元を、カリキュラムの並び順(sort_order)で先頭から2件
  const nextUnitTitles = [...rows]
    .filter((r) => !(r.progress?.lessons ?? []).some((l) => l.lesson_date))
    .sort((a, b) => a.sort_order - b.sort_order)
    .slice(0, 2)
    .map((r) => r.title);

  const homeworkNotDoneCount = rows.filter((r) => r.progress?.homework_not_done).length;
  const tardyCount = rows.filter((r) => r.progress?.tardy).length;

  return { ...base, recentLessons, nextUnitTitles, homeworkNotDoneCount, tardyCount };
}

/* ============================================================
 * 通塾日程・講習申込の整形
 * ------------------------------------------------------------
 * 2カラム再構成（成績・進行表を主役にする）で「基本情報」カードは廃止したため、
 * 現在ワークスペース内では未使用。他画面からの再利用や将来の復活に備えて残す
 * 純粋関数（テストで担保）。
 * ========================================================== */

/** 通塾日程を「火19:00 / 木19:00」形式にまとめる */
export function formatRegularPatternsSchedule(patterns: ScheduleRegularPattern[]): string {
  if (patterns.length === 0) return '未設定';

  const seen = new Set<string>();
  const items: { order: number; label: string }[] = [];
  for (const p of patterns) {
    const dayLabel = DAY_OF_WEEK_LABELS[p.day_of_week] ?? '?';
    const time = p.time_slot?.start_time ? p.time_slot.start_time.slice(0, 5) : '';
    const label = time ? `${dayLabel}${time}` : dayLabel;
    if (seen.has(label)) continue;
    seen.add(label);
    items.push({ order: p.day_of_week * 10000 + (p.time_slot?.slot_number ?? 0), label });
  }
  items.sort((a, b) => a.order - b.order);
  return items.map((i) => i.label).join(' / ');
}

/** 講習申込を季節ごとに合算して「夏期: 16コマ、冬期: 8コマ」形式にまとめる */
export function formatKoushuEnrollments(enrollments: KoushuEnrollment[]): string {
  if (enrollments.length === 0) return '申込なし';
  const bySeason = new Map<string, number>();
  for (const e of enrollments) {
    const key = e.season ?? '';
    bySeason.set(key, (bySeason.get(key) ?? 0) + (e.koma_count ?? 0));
  }
  return Array.from(bySeason.entries())
    .map(
      ([season, koma]) =>
        `${SEASON_LABELS[season as keyof typeof SEASON_LABELS] ?? season}: ${koma}コマ`
    )
    .join('、');
}

/* ============================================================
 * 成績サマリ（成績パネル・印刷シート共通）
 * ========================================================== */

/** 成績カテゴリ（Assessment['category'] のエイリアス。ここでの引数用に短く再掲する） */
export type AssessmentCategory = 'regular_test' | 'report_card' | 'mock';

// 科目の表示順。定期テスト/内申は共通9科、模試は換算内申などカテゴリによって出現する
// 科目集合が異なるため固定リストにはしない。ここでは「並べる優先順位」だけを決め、
// このリストに無い科目（他カテゴリで将来増えても）は末尾に回して落とさない。
const SUBJECT_ORDER = [
  'english',
  'math',
  'japanese',
  'science',
  'social',
  'music',
  'art',
  'tech_home',
  'pe',
  'conv_5',
  'conv_4',
] as const;

function subjectOrderIndex(subject: string): number {
  const i = (SUBJECT_ORDER as readonly string[]).indexOf(subject);
  return i === -1 ? SUBJECT_ORDER.length : i;
}

export interface ScoreSummaryRow {
  subject: string;
  label: string;
  values: (number | null)[]; // testLabels と同じ並び（古い→新しい）
}

export interface ScoreSummary {
  testLabels: string[]; // 直近N件、古い→新しい順
  rows: ScoreSummaryRow[];
  totals: number[]; // 各テストの合計点（testLabels と同じ並び）
}

/**
 * 指定カテゴリの直近N件を集計する（既定は定期テスト直近3件。印刷シートの従来仕様と同じ）。
 * listAssessments() は新しい順（降順）で返るため、先頭N件を取ってから
 * 表示用に古い→新しい順へ反転する（成績推移として左から右に読めるように）。
 *
 * 科目行はカテゴリごとの固定リストを使わず、実際に scores に出現した科目だけから作る
 * （内申は9科、模試は換算内申など、カテゴリで科目集合が違うため）。
 */
export function computeScoreSummary(
  assessments: AssessmentWithScores[],
  category: AssessmentCategory = 'regular_test',
  count = 3
): ScoreSummary {
  const picked = assessments
    .filter((a) => a.category === category)
    .slice(0, count)
    .reverse();

  const testLabels = picked.map((a) => ASSESSMENT_NAME_LABELS[a.name_code] ?? a.name_code);

  const subjectSet = new Set<string>();
  for (const a of picked) {
    for (const s of a.scores) subjectSet.add(s.subject);
  }
  const subjects = Array.from(subjectSet).sort(
    (a, b) => subjectOrderIndex(a) - subjectOrderIndex(b) || a.localeCompare(b)
  );

  const rows: ScoreSummaryRow[] = subjects.map((subject) => ({
    subject,
    label: SUBJECT_LABELS[subject] ?? subject,
    values: picked.map((a) => a.scores.find((s) => s.subject === subject)?.value ?? null),
  }));
  const totals = picked.map((_, i) => rows.reduce((sum, row) => sum + (row.values[i] ?? 0), 0));

  return { testLabels, rows, totals };
}

/* ============================================================
 * 宿題・遅刻の月次集計（宿題・遅刻パネル・印刷シート共通）
 * ========================================================== */

/** 宿題・遅刻の月次集計1行分 */
export interface DisciplineMonth {
  month: string; // 'YYYY-MM'
  label: string; // '2026年7月'
  lessonDays: number; // 授業日数（session_dateのユニーク数）
  homeworkMissedDays: number; // 宿題忘れがあった日数
  tardyDays: number; // 遅刻があった日数
}

/**
 * 生徒の宿題忘れ・遅刻を月次で集計する（宿題・遅刻パネル・印刷シート共通）。
 *
 * 教材ごとに1セッション行が立つため、同じ授業日に複数教材のセッションが存在しうる。
 * ここでは「日単位」で数える: 同日の行のうちどれか1件でも homework_not_done/tardy が
 * true ならその日を1日として数える（教材数ぶんの二重計上を防ぐ）。
 *
 * today を含む月から遡って monthsBack ヶ月分を対象にし、記録の無い月も
 * lessonDays: 0 で埋めたうえで新しい月が先頭になる配列で返す。範囲外の日付は無視する。
 * 月キーは session_date（'YYYY-MM-DD'）の先頭7文字をそのまま使う（タイムゾーン変換不要）。
 */
export function computeDisciplineMonthly(
  sessions: { session_date: string; homework_not_done: boolean; tardy: boolean }[],
  monthsBack: number,
  today: Date
): DisciplineMonth[] {
  // 対象月キー（新しい順）を先に確定する。範囲外の月は後段で無視する。
  const monthKeys: string[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const monthKeySet = new Set(monthKeys);

  // 日単位でフラグを集約する: 同日に複数教材の行があっても、どれか1件が true ならその日は true
  const dayHomework = new Map<string, boolean>();
  const dayTardy = new Map<string, boolean>();
  const daysByMonth = new Map<string, Set<string>>();
  for (const s of sessions) {
    const monthKey = s.session_date.slice(0, 7);
    if (!monthKeySet.has(monthKey)) continue; // 範囲外の日付は無視

    if (!daysByMonth.has(monthKey)) daysByMonth.set(monthKey, new Set());
    daysByMonth.get(monthKey)!.add(s.session_date);

    if (s.homework_not_done) dayHomework.set(s.session_date, true);
    if (s.tardy) dayTardy.set(s.session_date, true);
  }

  return monthKeys.map((monthKey) => {
    const days = daysByMonth.get(monthKey) ?? new Set<string>();
    let homeworkMissedDays = 0;
    let tardyDays = 0;
    for (const day of Array.from(days)) {
      if (dayHomework.get(day)) homeworkMissedDays++;
      if (dayTardy.get(day)) tardyDays++;
    }
    const [y, m] = monthKey.split('-');
    return {
      month: monthKey,
      label: `${y}年${Number(m)}月`,
      lessonDays: days.size,
      homeworkMissedDays,
      tardyDays,
    };
  });
}

/**
 * 全生徒ぶんのセッション行を生徒ごとにグループ化し、それぞれ computeDisciplineMonthly で月次集計する。
 * 集計ロジックを二重実装しないため、既存の computeDisciplineMonthly に委譲する
 * （面談入口一覧の「宿題・遅刻」全生徒集計ビュー用）。
 *
 * Map のキーは student_id。rows に一度も登場しない生徒はエントリ自体を作らない
 * （呼び出し側で「記録なし」扱いにするため）。
 */
export function computeDisciplineMonthlyByStudent(
  rows: { student_id: string; session_date: string; homework_not_done: boolean; tardy: boolean }[],
  monthsBack: number,
  today: Date
): Map<string, DisciplineMonth[]> {
  const byStudent = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byStudent.get(row.student_id);
    if (list) {
      list.push(row);
    } else {
      byStudent.set(row.student_id, [row]);
    }
  }

  const result = new Map<string, DisciplineMonth[]>();
  for (const [studentId, studentRows] of Array.from(byStudent.entries())) {
    result.set(studentId, computeDisciplineMonthly(studentRows, monthsBack, today));
  }
  return result;
}

/** 全生徒合算の月次合計1行分 */
export interface DisciplineMonthTotal extends DisciplineMonth {
  /** その月に授業記録が1日以上あった生徒数 */
  studentCount: number;
}

/**
 * 生徒ごとの月次集計（画面に既に出している DisciplineRow.months の配列そのもの）を
 * 月単位で合算して「全体」の月次合計を作る。
 *
 * 生の session 行から再集計しない理由: 画面の生徒行と「全体」合計行で数字が食い違うと
 * 集計の信頼性が疑われる。既に各生徒行の表示に使っている computeDisciplineMonthly の
 * 出力をそのまま足し上げることで、生徒行の合計＝全体行になることを構造的に保証する。
 *
 * 月の枠組み（対象月キー・label・新しい月が先頭の順序）は computeDisciplineMonthly([], ...) で
 * 作り、そこに各生徒の同月の値を月キーで対応付けて足し込む（配列インデックスの並びに
 * 依存すると、生徒によって記録の欠けた月がある場合にズレるため）。
 */
export function computeDisciplineMonthlyTotals(
  perStudentMonths: DisciplineMonth[][],
  monthsBack: number,
  today: Date
): DisciplineMonthTotal[] {
  const frame = computeDisciplineMonthly([], monthsBack, today);
  const totalsByMonth = new Map<string, DisciplineMonthTotal>(
    frame.map((m) => [m.month, { ...m, studentCount: 0 }])
  );

  for (const months of perStudentMonths) {
    for (const m of months) {
      const total = totalsByMonth.get(m.month);
      if (!total) continue; // 対象範囲外の月キーは無視（通常は起こらない想定）
      total.lessonDays += m.lessonDays;
      total.homeworkMissedDays += m.homeworkMissedDays;
      total.tardyDays += m.tardyDays;
      if (m.lessonDays > 0) total.studentCount += 1;
    }
  }

  return frame.map((m) => totalsByMonth.get(m.month)!);
}

/**
 * 「注意が必要」とみなす割合のしきい値。この値以上の月は赤字にして目に留まりやすくする。
 * 根拠のある値ではなく運用上の目安のため、必要に応じて調整してよい。
 * 宿題・遅刻パネル（1生徒用）と面談入口の全生徒集計ビューの両方で使うため、ここに集約する
 * （二重定義しない）。
 */
export const DISCIPLINE_ALERT_RATIO_THRESHOLD = 0.3;
