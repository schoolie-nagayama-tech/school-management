/**
 * 面談ワークスペース共有ロジック
 * ------------------------------------------------------------------
 * ページ本体・左右カラム・印刷シートの複数コンポーネントから参照する
 * 純粋関数・型・定数をここにまとめる（ロジックの二重実装を防ぐため）。
 */

import type {
  AssessmentWithScores,
  CurriculumItemWithProgress,
  InterviewType,
  StudentTextbookWithDetails,
} from '@/types/database';
import { ASSESSMENT_NAME_LABELS, SEASON_LABELS, SUBJECT_LABELS } from '@/types/database';
import type { ScheduleRegularPattern } from '@/types/schedule';
import { DAY_OF_WEEK_LABELS } from '@/types/schedule';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';

/* ============================================================
 * 話題チップ・面談種別
 * ========================================================== */

// 中央カラムのメモに見出しを挿入するための話題チップ。
// 「次回への申し送り」だけは左カラムの extractHandover と対になっており、
// 挿入される見出し文言 `## 次回への申し送り` を変更する場合は extractHandover も合わせて直すこと。
export const TOPIC_CHIPS = [
  '成績について',
  '宿題・家庭学習',
  '講習の提案',
  '進路・受験',
  '学校での様子',
  '次回への申し送り',
] as const;

// 新規メモ入力で選べる面談種別（'task' は約束・宿題クイック登録から別途作られるため除外）
export const MEMO_INTERVIEW_TYPES: InterviewType[] = [
  'parent_interview',
  'phone',
  'student_interview',
  'casual',
  'enrollment',
  'other',
];

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
 * 中央カラムの話題チップ「次回への申し送り」を押すと本文末尾に
 * `## 次回への申し送り` という見出しが挿入される設計になっており、この関数はその対。
 * 次回の面談時、左カラムの「前回の申し送り」ピン留めカードに表示するため、
 * 直近の面談本文からこの見出し以降〜次の `##` 見出し（無ければ末尾）までを取り出す。
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

/* ============================================================
 * 通塾日程・講習申込の整形（基本情報カード用）
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
 * 成績サマリ（右カラム・印刷シート共通）
 * ========================================================== */

// 成績サマリで表示する5科（StudentDetailModal の formatScoreRow と同じ集合に揃える）
const SCORE_SUBJECTS = ['english', 'math', 'japanese', 'social', 'science'] as const;

export interface ScoreSummaryRow {
  subject: string;
  label: string;
  values: (number | null)[]; // recentTests と同じ並び（古い→新しい）
}

export interface ScoreSummary {
  testLabels: string[]; // 直近3件、古い→新しい順
  rows: ScoreSummaryRow[];
  totals: number[]; // 各テストの合計点（testLabels と同じ並び）
}

/**
 * 定期テストの直近3件を集計する。
 * listAssessments() は新しい順（降順）で返るため、先頭3件を取ってから
 * 表示用に古い→新しい順へ反転する（成績推移として左から右に読めるように）。
 */
export function computeScoreSummary(assessments: AssessmentWithScores[]): ScoreSummary {
  const regular = assessments
    .filter((a) => a.category === 'regular_test')
    .slice(0, 3)
    .reverse();

  const testLabels = regular.map((a) => ASSESSMENT_NAME_LABELS[a.name_code] ?? a.name_code);
  const rows: ScoreSummaryRow[] = SCORE_SUBJECTS.map((subject) => ({
    subject,
    label: SUBJECT_LABELS[subject] ?? subject,
    values: regular.map((a) => a.scores.find((s) => s.subject === subject)?.value ?? null),
  }));
  const totals = regular.map((_, i) => rows.reduce((sum, row) => sum + (row.values[i] ?? 0), 0));

  return { testLabels, rows, totals };
}

/* ============================================================
 * 今回の面談メモ 下書き（localStorage）
 * ========================================================== */

export interface InterviewDraft {
  interviewDate: string;
  interviewType: InterviewType;
  title: string;
  memo: string;
  insertedTopics: string[];
  quickTasks: string[];
}

const DRAFT_KEY_PREFIX = 'nest-interview-draft-v1:';

/**
 * 下書きの自動保存。面談中に画面遷移や誤操作で入力中のメモが消えると致命的なため、
 * 生徒ID込みのキーで localStorage に退避し、再訪時に復元する。
 */
export function loadInterviewDraft(studentId: string): InterviewDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY_PREFIX + studentId);
    if (!raw) return null;
    return JSON.parse(raw) as InterviewDraft;
  } catch {
    return null;
  }
}

export function saveInterviewDraft(studentId: string, draft: InterviewDraft): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DRAFT_KEY_PREFIX + studentId, JSON.stringify(draft));
  } catch {
    // 容量超過等は無視する（下書き機能は失敗しても致命的ではない）
  }
}

export function clearInterviewDraft(studentId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DRAFT_KEY_PREFIX + studentId);
  } catch {
    // noop
  }
}
