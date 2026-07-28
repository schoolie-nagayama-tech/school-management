// 新・生徒進捗ページ(NewProgressPage)とその子コンポーネント群で共有する
// 型・定数・純粋ヘルパー。挙動を持たない定義だけを集約したもの。
import type { ExamType, StudentTextbookWithDetails } from '@/types/database';

// ─────────────────────────────────────────────
// 型
// ─────────────────────────────────────────────
export type View = 'cards' | 'table';
export type ViewMode = 'admin' | 'meeting';

/**
 * 指導意図のマスタ。教室長はグループ先頭行でこれを1つ選ぶだけ。
 * 面談モードの根拠文はここから自動生成される（自由記述は不要）。
 */
export const INTENT_TAGS = [
  '苦手補強',
  '既習の定着',
  '未習の先取り',
  '学校進度に合わせる',
  '直前演習',
  '応用発展',
] as const;
export type IntentTag = (typeof INTENT_TAGS)[number];

/** 指導意図チップの色（控えめ：文字色 + 境界線のみ。背景なし） */
export const INTENT_TAG_COLOR: Record<IntentTag, string> = {
  苦手補強: 'text-red-700 border-red-200',
  既習の定着: 'text-blue-700 border-blue-200',
  未習の先取り: 'text-purple-700 border-purple-200',
  学校進度に合わせる: 'text-emerald-700 border-emerald-200',
  直前演習: 'text-amber-700 border-amber-200',
  応用発展: 'text-indigo-700 border-indigo-200',
};

export function isIntentTag(v: unknown): v is IntentTag {
  return typeof v === 'string' && (INTENT_TAGS as readonly string[]).includes(v);
}

type LessonLike = { lesson_date?: string | null };
type CurriculumItemLike = { lessons?: LessonLike[] };
type TextbookWithItems = StudentTextbookWithDetails & { curriculum_items?: CurriculumItemLike[] };

// 面談モードで表示する列の表示フラグ
export type MeetingColMap = {
  proposal: boolean;
  application: boolean;
  examRange: boolean;
  schoolProgress: boolean;
  lesson1: boolean;
  lesson2: boolean;
  lesson3: boolean;
  handover: boolean;
  homeworkNotDone: boolean;
  tardy: boolean;
  teacherName: boolean;
};

// 科目を5列（国語/数学/英語/理科/社会）+ その他にカテゴリ分け
export const SUBJECT_COLUMNS = ['国語', '数学', '英語', '理科', '社会'] as const;
export type SubjectColumn = (typeof SUBJECT_COLUMNS)[number] | 'その他';

export const SUBJECT_COLOR: Record<SubjectColumn, { bg: string; text: string; accent: string }> = {
  国語: { bg: 'bg-rose-50', text: 'text-rose-800', accent: 'border-rose-300' },
  数学: { bg: 'bg-blue-50', text: 'text-blue-800', accent: 'border-blue-300' },
  英語: { bg: 'bg-emerald-50', text: 'text-emerald-800', accent: 'border-emerald-300' },
  理科: { bg: 'bg-purple-50', text: 'text-purple-800', accent: 'border-purple-300' },
  社会: { bg: 'bg-amber-50', text: 'text-amber-800', accent: 'border-amber-300' },
  その他: { bg: 'bg-gray-50', text: 'text-gray-700', accent: 'border-gray-300' },
};

// ─────────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────────
/**
 * 進行表用の学年ラベル（8 → '中学2年生'）。
 *
 * ★ 共通の formatGradeLabel（'中2'）と別実装なのは意図的: こちらは講師向け進行表の
 *   長い表記で、主体も文脈も違う。共通ヘルパに寄せると片方の表記変更が
 *   もう片方を巻き添えにする。表記だけ別、値の意味は GRADE_LABELS と揃える。
 *
 * ★ 13（既卒）に長い表記は無いので GRADE_LABELS と同じ '既卒' を返す。
 *   ここを落とすと既卒の生徒だけ学年が空欄になる。
 */
export function gradeLabel(grade: number | null | undefined): string {
  if (grade == null) return '';
  if (grade <= 6) return `小学${grade}年生`;
  if (grade <= 9) return `中学${grade - 6}年生`;
  if (grade <= 12) return `高校${grade - 9}年生`;
  if (grade === 13) return '既卒';
  return '';
}

export function daysLeftOf(examDate: string | null | undefined): number | null {
  if (!examDate) return null;
  const d = new Date(examDate);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function seasonLabel(season: string | null | undefined): string | null {
  if (!season) return null;
  if (season === 'spring') return '春期';
  if (season === 'summer') return '夏期';
  if (season === 'winter') return '冬期';
  return null;
}

// 停滞判定（最終授業日から14日経過）
export function isStalled(tb: StudentTextbookWithDetails): {
  stalled: boolean;
  lastDate: string | null;
} {
  let last: string | null = null;
  const items = (tb as TextbookWithItems).curriculum_items || [];
  const lessons = items.flatMap((ci) => ci.lessons || []);
  for (const l of lessons) {
    if (l.lesson_date && (!last || l.lesson_date > last)) last = l.lesson_date;
  }
  if (!last) return { stalled: false, lastDate: null };
  const days = daysLeftOf(last);
  return { stalled: days !== null && days < -14, lastDate: last };
}

export function progressStats(tb: StudentTextbookWithDetails): { total: number; done: number } {
  const items = (tb as TextbookWithItems).curriculum_items || [];
  const total = items.length;
  const done = items.filter((ci) => (ci.lessons || []).some((l) => l.lesson_date)).length;
  return { total, done };
}

// item_number は DB から文字列で返る場合があるため number に正規化
export function itemNo(row: { item_number?: number | string | null }): number | null {
  const v = row?.item_number;
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function categorizeSubject(subject: string | null | undefined): SubjectColumn {
  if (!subject) return 'その他';
  const s = String(subject).trim();
  if (/国語|現代文|古文|漢文|古典/.test(s)) return '国語';
  if (/数学|算数/.test(s)) return '数学';
  if (/英語|English/i.test(s)) return '英語';
  if (/理科|物理|化学|生物|地学/.test(s)) return '理科';
  if (/社会|歴史|地理|公民|日本史|世界史|政経|倫理/.test(s)) return '社会';
  return 'その他';
}

export function sortByOrder(list: StudentTextbookWithDetails[]): StudentTextbookWithDetails[] {
  return [...list].sort((a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.created_at ?? '').localeCompare(b.created_at ?? '');
  });
}

export function activeExamOf(
  tb: StudentTextbookWithDetails,
  examTypes: ExamType[] = []
): {
  id: string;
  exam_type_id: string | null;
  name: string;
  date: string | null;
  daysLeft: number | null;
  targetScore: number | null;
} | null {
  const exams = tb.exams || [];
  if (exams.length === 0) return null;
  const future = exams
    .filter((e) => e.exam_date)
    .map((e) => ({ e, dl: daysLeftOf(e.exam_date) ?? -9999 }))
    .filter((x) => x.dl >= 0)
    .sort((a, b) => a.dl - b.dl);
  const pick = future[0]?.e ?? exams[0];
  const etName = examTypes.find((t) => t.id === pick.exam_type_id)?.name;
  return {
    id: pick.id,
    exam_type_id: pick.exam_type_id ?? null,
    name: etName || pick.custom_exam_name || '目標設定',
    date: pick.exam_date,
    daysLeft: daysLeftOf(pick.exam_date),
    targetScore: pick.target_score,
  };
}

/** 今日の日付 (YYYY-MM-DD) */
export const todayIso = () => new Date().toISOString().slice(0, 10);
