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
