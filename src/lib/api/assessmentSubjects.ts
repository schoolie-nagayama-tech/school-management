import { supabase } from '../supabase';

export interface AssessmentSubject {
  id: string;
  school_id: string | null;
  code: string;
  name: string;
  short_name: string | null;
  school_type: '小学' | '中学' | '高校' | '共通';
  applicable_grades: number[];
  category: string;
  is_required: boolean;
  is_system: boolean;
  sort_order: number;
  is_active: boolean;
}

/** 学年から学校種別を判定 */
export function gradeToSchoolType(grade: number): '小学' | '中学' | '高校' {
  if (grade <= 6) return '小学';
  if (grade <= 9) return '中学';
  return '高校';
}

/**
 * 評価科目マスタを取得（学年・教室で絞り込み）
 * 教室カスタム（school_id 一致）と共通（school_id NULL）の両方を返す
 */
export async function getAssessmentSubjects(opts: {
  grade?: number;
  schoolType?: '小学' | '中学' | '高校';
  schoolId?: string | null;
} = {}): Promise<AssessmentSubject[]> {
  const { data, error } = await (supabase
    .from('assessment_subjects' as never) as any)
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    if (error.code === 'PGRST116' || (error.message ?? '').includes('schema cache')) {
      return [];
    }
    throw new Error(`評価科目の取得に失敗しました: ${error.message}`);
  }

  let rows = (data ?? []) as AssessmentSubject[];

  if (opts.schoolId !== undefined) {
    rows = rows.filter((r) => r.school_id === null || r.school_id === opts.schoolId);
  }
  if (opts.schoolType) {
    rows = rows.filter((r) => r.school_type === opts.schoolType || r.school_type === '共通');
  }
  if (opts.grade !== undefined) {
    rows = rows.filter((r) => r.applicable_grades.includes(opts.grade!));
  }
  return rows;
}

export interface AssessmentSubjectInput {
  school_id?: string | null;
  code: string;
  name: string;
  short_name?: string | null;
  school_type: '小学' | '中学' | '高校' | '共通';
  applicable_grades: number[];
  category: string;
  is_required?: boolean;
  sort_order?: number;
  is_active?: boolean;
}

/** 科目を作成 */
export async function createAssessmentSubject(input: AssessmentSubjectInput): Promise<AssessmentSubject> {
  const { data, error } = await (supabase
    .from('assessment_subjects' as never) as any)
    .insert({
      school_id: input.school_id ?? null,
      code: input.code,
      name: input.name,
      short_name: input.short_name ?? null,
      school_type: input.school_type,
      applicable_grades: input.applicable_grades,
      category: input.category,
      is_required: input.is_required ?? false,
      is_system: false,
      sort_order: input.sort_order ?? 999,
      is_active: input.is_active ?? true,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('同じコードの科目が既に存在します');
    throw new Error(`科目の作成に失敗しました: ${error.message}`);
  }
  return data as AssessmentSubject;
}

/** 科目を更新 */
export async function updateAssessmentSubject(
  id: string,
  patch: Partial<Omit<AssessmentSubjectInput, 'school_id'>>
): Promise<void> {
  const { error } = await (supabase
    .from('assessment_subjects' as never) as any)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`科目の更新に失敗しました: ${error.message}`);
}

/** 科目を削除（非アクティブ化） */
export async function deactivateAssessmentSubject(id: string): Promise<void> {
  const { error } = await (supabase
    .from('assessment_subjects' as never) as any)
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`科目の無効化に失敗しました: ${error.message}`);
}

/** 科目を物理削除（システム科目は削除しない） */
export async function deleteAssessmentSubject(id: string): Promise<void> {
  const { error } = await (supabase
    .from('assessment_subjects' as never) as any)
    .delete()
    .eq('id', id)
    .eq('is_system', false);
  if (error) throw new Error(`科目の削除に失敗しました: ${error.message}`);
}

/** 全件（無効も含む）取得：管理画面用 */
export async function getAllAssessmentSubjects(): Promise<AssessmentSubject[]> {
  const { data, error } = await (supabase
    .from('assessment_subjects' as never) as any)
    .select('*')
    .order('school_type', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) {
    if (error.code === 'PGRST116' || (error.message ?? '').includes('schema cache')) return [];
    throw new Error(`評価科目の取得に失敗しました: ${error.message}`);
  }
  return (data ?? []) as AssessmentSubject[];
}
