/**
 * 成績表からの下書きで使う、教材と講習コースの読み込み（画面から呼ぶ）。
 * 正典: docs/score-sheet-plan-draft.md §5・§6
 *
 * ★どれも読むだけ。書き込みは保存のとき、いまの提案書と同じ関数（upsertProposal ほか）でする。
 */

import { supabase } from '@/lib/supabase';
import { getCourseCurriculum, getSeasonalCourse } from '@/lib/api/seasonalCourses';
import type { CurriculumItem } from '@/types/database';
import type { CourseBook, CourseTier } from './planRules';
import type { PcsTextbookMapping } from './pcsMappings';
import type { PlanUnit, ScoreSubject } from './types';

const SUBJECT_JA: Record<ScoreSubject, string> = { math: '数学', eng: '英語' };

/**
 * 画面に出す単元の並び。★伏せた単元（is_active=false）は出さない
 * （フォレスタ社会の準拠版を統合したとき、単元を消さずに伏せる運用にした）
 */
function toPlanUnits(items: CurriculumItem[]): PlanUnit[] {
  return items
    .filter((i) => (i as { is_active?: boolean | null }).is_active !== false)
    .map((i) => ({ id: i.id, no: i.item_number ?? null, title: i.title ?? '' }));
}

export interface LoadedTextbook {
  textbookId: number;
  label: string;
  units: PlanUnit[];
  items: CurriculumItem[];
}

/** 対応表が指す教材（名前・科目・学年）を引いて、単元を読む。見つからなければ null */
export async function loadMappedTextbook(m: PcsTextbookMapping): Promise<LoadedTextbook | null> {
  const { data: tb } = await supabase
    .from('textbooks')
    .select('id, name, subject, grade')
    .eq('name', m.textbook.name)
    .eq('subject', m.textbook.subject)
    .eq('grade', m.textbook.grade)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!tb) return null;
  const { data: items } = await supabase
    .from('curriculum_items')
    .select('*')
    .eq('textbook_id', tb.id)
    .order('sort_order');
  const list = (items ?? []) as CurriculumItem[];
  return {
    textbookId: tb.id as number,
    label: `${tb.grade} ${tb.subject} ${tb.name}`,
    units: toPlanUnits(list),
    // ★単元一覧に出す行と units をそろえる（伏せた単元を片方だけに残さない）
    items: list.filter((i) => (i as { is_active?: boolean | null }).is_active !== false),
  };
}

/** 単元番号 → units の添字。★同じ番号が2回出る教材（フォレスタステップ1年の小学校の復習）は最初の方 */
export function indexByNo(units: PlanUnit[]): Map<string, number> {
  const m = new Map<string, number>();
  units.forEach((u, i) => {
    if (u.no && !m.has(u.no)) m.set(u.no, i);
  });
  return m;
}

export interface CourseOption {
  id: string;
  name: string;
  tier: CourseTier | null;
}

/**
 * その教室の中3・冬期の都立対策コースの候補。
 * ★名前で見つけるのは「初めに選んでおく」ためだけ。画面で選び直せる（名前は教室が変えられる）
 */
export async function findTorituCourses(
  schoolId: string,
  subject: ScoreSubject
): Promise<CourseOption[]> {
  const { data } = await supabase
    .from('seasonal_courses')
    .select('id, name, target_grades')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .eq('season', 'winter')
    .ilike('name', '%都立入試対策%')
    .order('name');
  return ((data ?? []) as { id: string; name: string; target_grades: number[] | null }[])
    .filter((c) => c.name.includes(SUBJECT_JA[subject]))
    .filter((c) => !c.target_grades?.length || c.target_grades.includes(9))
    .map((c) => ({
      id: c.id,
      name: c.name,
      tier: c.name.includes('上位校') ? 'upper' : c.name.includes('中堅校') ? 'mid' : null,
    }));
}

/**
 * コースに入っている冊を、テキストの全単元つきで読む。
 * ★過去問の教材は1冊に全科目が入っている（textbooks.subject が空で、単元ごとに科目を持つ）。
 *   その教科の単元だけを出す。
 * ★コースの単元設定は「まとまりの先頭だけにコマを入れ、残りは0」の約束（courseSettingAdapter）。
 */
export async function loadCourseBooks(
  courseId: string,
  subject: ScoreSubject
): Promise<(CourseBook & { items: CurriculumItem[] })[]> {
  const course = await getSeasonalCourse(courseId);
  if (!course) return [];
  const books: (CourseBook & { items: CurriculumItem[] })[] = [];
  for (const ct of course.textbooks ?? []) {
    const tb = ct.textbook as
      | { id: number; name: string; grade: string | null; subject: string | null }
      | undefined;
    if (!tb) continue;
    const { items, settings } = await getCourseCurriculum(courseId, tb.id);
    const setting = new Map(settings.map((s) => [s.curriculum_item_id, s]));
    const isKako = tb.name.includes('過去問');
    const visible = items.filter((i) => {
      const unitSubject = (i as { subject?: string | null }).subject ?? null;
      return !isKako || unitSubject == null || unitSubject === SUBJECT_JA[subject];
    });
    books.push({
      textbookId: tb.id,
      label: [tb.grade, tb.subject || SUBJECT_JA[subject], tb.name].filter(Boolean).join(' '),
      isKako,
      items: visible.filter((i) => (i as { is_active?: boolean | null }).is_active !== false),
      units: toPlanUnits(visible).map((u) => {
        const s = setting.get(u.id);
        return {
          ...u,
          tplKoma: s ? s.proposal_count : null,
          tplGroup: s?.group_number ?? 0,
        };
      }),
    });
  }
  return books;
}
