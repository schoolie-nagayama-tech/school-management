import { supabase } from '@/lib/supabase';

export interface Teacher {
  id: string;
  school_id: string;
  name: string;
  name_kana?: string | null;
  email?: string | null;
  phone?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  school?: {
    id: string;
    name: string;
    code: string;
  };
}

export interface TeacherFormData {
  name: string;
  name_kana?: string;
  email?: string;
  phone?: string;
  is_active: boolean;
}

// 講師一覧を取得
export async function getTeachers(schoolId?: string): Promise<Teacher[]> {
  let query = supabase
    .from('teachers')
    .select(`
      *,
      school:schools(id, name, code)
    `)
    .order('name');

  if (schoolId) {
    query = query.eq('school_id', schoolId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching teachers:', error);
    throw new Error('講師一覧の取得に失敗しました');
  }
  return (data || []) as Teacher[];
}

// 有効な講師のみ取得
export async function getActiveTeachers(schoolId: string): Promise<Teacher[]> {
  const { data, error } = await supabase
    .from('teachers')
    .select('*')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('name');

  if (error) {
    console.error('Error fetching active teachers:', error);
    throw new Error('講師一覧の取得に失敗しました');
  }
  return (data || []) as Teacher[];
}

// 講師を取得
export async function getTeacher(id: string): Promise<Teacher> {
  const { data, error } = await supabase
    .from('teachers')
    .select(`
      *,
      school:schools(id, name, code)
    `)
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching teacher:', error);
    throw new Error('講師情報の取得に失敗しました');
  }
  return data as Teacher;
}

// 講師を作成
export async function createTeacher(
  schoolId: string,
  formData: TeacherFormData
): Promise<Teacher> {
  const { data, error } = await supabase
    .from('teachers')
    .insert({
      school_id: schoolId,
      ...formData,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating teacher:', error);
    throw new Error('講師の作成に失敗しました');
  }
  return data as Teacher;
}

// 講師を更新
export async function updateTeacher(
  id: string,
  formData: Partial<TeacherFormData>
): Promise<Teacher> {
  const { data, error } = await supabase
    .from('teachers')
    .update(formData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating teacher:', error);
    throw new Error('講師の更新に失敗しました');
  }
  return data as Teacher;
}

// 講師を削除
export async function deleteTeacher(id: string): Promise<void> {
  const { error } = await supabase
    .from('teachers')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting teacher:', error);
    throw new Error('講師の削除に失敗しました');
  }
}
