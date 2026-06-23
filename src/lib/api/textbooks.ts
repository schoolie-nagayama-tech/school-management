import { supabase } from '@/lib/supabase';
import type {
  Textbook,
  TextbookInsert,
  TextbookUpdate,
  CurriculumItem,
  CurriculumItemInsert,
  CurriculumItemUpdate,
  ExamType,
  ExamTypeInsert,
  ExamTypeUpdate,
} from '@/types/database';
import { getDefaultSchoolId } from './schools';

// ============================================
// テスト名マスタ（exam_types）
// ============================================

/**
 * テスト名マスタ一覧を取得
 */
export async function getExamTypes(schoolId?: string): Promise<ExamType[]> {
  const targetSchoolId = schoolId || getDefaultSchoolId();
  const { data, error } = await supabase
    .from('exam_types')
    .select('*')
    .eq('school_id', targetSchoolId)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error(`テスト名マスタの取得に失敗しました: ${error.message}`);
  }

  return (data || []) as ExamType[];
}

/**
 * テスト名マスタを作成
 */
export async function createExamType(examType: ExamTypeInsert): Promise<ExamType> {
  const { data, error } = await supabase.from('exam_types').insert(examType).select().single();

  if (error) {
    throw new Error(`テスト名マスタの作成に失敗しました: ${error.message}`);
  }

  return data as ExamType;
}

/**
 * テスト名マスタを更新
 */
export async function updateExamType(id: string, examType: ExamTypeUpdate): Promise<ExamType> {
  const { data, error } = await supabase
    .from('exam_types')
    .update(examType)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`テスト名マスタの更新に失敗しました: ${error.message}`);
  }

  return data as ExamType;
}

/**
 * テスト名マスタを削除
 */
export async function deleteExamType(id: string): Promise<void> {
  const { error } = await supabase.from('exam_types').delete().eq('id', id);

  if (error) {
    throw new Error(`テスト名マスタの削除に失敗しました: ${error.message}`);
  }
}

// ============================================
// テキストマスタ（textbooks）
// ============================================

/**
 * テキストマスタ一覧を取得
 * @param opts.includeInactive 無効化（非表示）教材も含める。既定 false（各種ピッカーでは隠す）。
 *   教材マスタ画面のみ true を渡して全件表示し、トグルで有効/無効を切り替える。
 */
export async function getTextbooks(
  gradeCategory?: 'elementary' | 'middle' | 'high',
  opts?: { includeInactive?: boolean }
): Promise<Textbook[]> {
  let query = supabase.from('textbooks').select('*');

  if (gradeCategory) {
    query = query.eq('grade_category', gradeCategory);
  }

  // 無効化された教材は既定で一覧・ピッカーから除外する（データは消さず非表示にするだけ）。
  if (!opts?.includeInactive) {
    query = query.eq('is_active', true);
  }

  // 学校種別（小学→中学→高校）→ テキスト名 → 学年 の順でソート
  query = query
    .order('school_type', { ascending: true })
    .order('name', { ascending: true })
    .order('grade', { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw new Error(`テキストマスタの取得に失敗しました: ${error.message}`);
  }

  return (data || []) as Textbook[];
}

/**
 * テキストマスタを作成
 */
export async function createTextbook(textbook: TextbookInsert): Promise<Textbook> {
  const { data, error } = await supabase.from('textbooks').insert(textbook).select().single();

  if (error) {
    throw new Error(`テキストマスタの作成に失敗しました: ${error.message}`);
  }

  return data as Textbook;
}

/**
 * テキストマスタを更新
 */
export async function updateTextbook(id: number, textbook: TextbookUpdate): Promise<Textbook> {
  const { data, error } = await supabase
    .from('textbooks')
    .update(textbook)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`テキストマスタの更新に失敗しました: ${error.message}`);
  }

  return data as Textbook;
}

/**
 * テキストマスタを削除
 */
export async function deleteTextbook(id: number): Promise<void> {
  const { error } = await supabase.from('textbooks').delete().eq('id', id);

  if (error) {
    throw new Error(`テキストマスタの削除に失敗しました: ${error.message}`);
  }
}

// ============================================
// 目次項目マスタ（curriculum_items）
// ============================================

/**
 * 目次項目一覧を取得（テキストID指定）
 */
export async function getCurriculumItems(textbookId: number): Promise<CurriculumItem[]> {
  const { data, error } = await supabase
    .from('curriculum_items')
    .select('*')
    .eq('textbook_id', textbookId)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error(`目次項目の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as CurriculumItem[];
}

/**
 * 目次項目を作成
 */
export async function createCurriculumItem(item: CurriculumItemInsert): Promise<CurriculumItem> {
  const { data, error } = await supabase.from('curriculum_items').insert(item).select().single();

  if (error) {
    throw new Error(`目次項目の作成に失敗しました: ${error.message}`);
  }

  return data as CurriculumItem;
}

/**
 * 目次項目を更新
 */
export async function updateCurriculumItem(
  id: number,
  item: CurriculumItemUpdate
): Promise<CurriculumItem> {
  const { data, error } = await supabase
    .from('curriculum_items')
    .update(item)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`目次項目の更新に失敗しました: ${error.message}`);
  }

  return data as CurriculumItem;
}

/**
 * 目次項目を削除
 */
export async function deleteCurriculumItem(id: number): Promise<void> {
  const { error } = await supabase.from('curriculum_items').delete().eq('id', id);

  if (error) {
    throw new Error(`目次項目の削除に失敗しました: ${error.message}`);
  }
}
