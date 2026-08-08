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

/**
 * テキスト名の頭に付ける学年ラベル。「中3」「小6」「高共通」の形に短縮する。
 *
 * textbooks.grade は「3年」「共通」のように学校種別を持たない値で入っており、それ単体では
 * 中3か高3か読めない。school_type（中学/小学/高校）と繋いで短縮形にする。
 * 既に「中2」のような短縮形で入っている値や、school_type が無い値はそのまま返す。
 */
export function textbookGradeLabel(
  tb: { grade?: string | null; school_type?: string | null } | null | undefined
): string | null {
  const grade = tb?.grade?.trim();
  if (!grade) return null;
  const short =
    tb?.school_type === '中学'
      ? '中'
      : tb?.school_type === '小学'
        ? '小'
        : tb?.school_type === '高校'
          ? '高'
          : null;
  if (!short) return grade;
  if (grade.startsWith(short)) return grade; // 「中2」「小6」に二重で付けない
  const year = grade.match(/^(\d+)年$/);
  return year ? `${short}${year[1]}` : `${short}${grade}`;
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

/**
 * 'YYYY-MM-DD' → '07/30'。SessionFeed の日付表記に合わせている。
 * 年をまたいでも月日だけで足りる（LIVE の古さは月日で十分伝わる）。
 */
export function monthDayLabel(date: string | null | undefined): string {
  if (!date) return '';
  return date.replace(/-/g, '/').slice(5);
}

/**
 * 科目ごとに「今使っているテキスト」を1冊だけ決める（LIVE バッジ用）。
 *
 * ★ 背景: 同一科目に2冊以上あるのは例外ではなく常態（本番実測で 612 組中 235 組＝約38%）。
 *   これまでは「手動で一番上に置く」運用で見分けていたため、並べ替え漏れがそのまま
 *   取り違えになっていた。最終利用日で機械的に決めて一目で分かるようにする。
 *
 * ★ 期限を設けない理由: 「直近60日以内」等で絞ると長期休み明けや久々の再開で
 *   どの科目にも LIVE が出なくなり、「一目で分かる」という目的を果たさない。
 *   その科目で一番新しければ必ず付け、古さは日付の併記で判断してもらう。
 *
 * ★ 並び順は変えない: 手動の並び（意図的に副教材を上に固定する等）を壊さないため、
 *   ここでは印を付けるだけで sort_order には触れない。
 *
 * 同日で並んだ場合は現行運用どおり手動並び順が上のものを LIVE とする。
 *
 * @param textbooks 対象生徒のテキスト（科目混在で可）
 * @param lastUsedByTextbook student_textbook_id → 最終利用日（getLastUsedDateByTextbook の戻り値）
 * @returns LIVE と判定した student_textbook_id の集合。記録が全く無い科目は選ばれない
 */
export function pickLiveTextbookIds(
  textbooks: StudentTextbookWithDetails[],
  lastUsedByTextbook: Record<string, string>
): Set<string> {
  // sortByOrder と同じ優先度（sort_order → created_at）を順位に落とすため、
  // 科目ごとに整列した配列の添字を「手動順」として使う。
  const bySubject: Record<string, StudentTextbookWithDetails[]> = {};
  for (const tb of textbooks) {
    const col = categorizeSubject(tb.textbook?.subject);
    (bySubject[col] ||= []).push(tb);
  }

  const best: Record<string, { id: string; date: string; order: number }> = {};
  for (const col of Object.keys(bySubject)) {
    sortByOrder(bySubject[col]).forEach((tb, index) => {
      const date = lastUsedByTextbook[tb.id];
      if (!date) return; // 授業記録が無いテキストは候補にしない
      const current = best[col];
      // 日付が新しい方。同日なら手動順が上（index が小さい）方を採る
      if (!current || date > current.date || (date === current.date && index < current.order)) {
        best[col] = { id: tb.id, date, order: index };
      }
    });
  }

  return new Set(Object.keys(best).map((col) => best[col].id));
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
