import { getSupabaseBrowserClient } from '@/lib/supabase';
import type { AttendanceType, AttendanceTypeFormData } from '@/types/attendance';

const supabase = getSupabaseBrowserClient();

// ========================================
// コマ種別マスタ API
// ========================================

// 教室のコマ種別一覧を取得
export async function getAttendanceTypes(schoolId: string): Promise<AttendanceType[]> {
  const { data, error } = await supabase
    .from('attendance_types')
    .select('*')
    .eq('school_id', schoolId)
    .order('display_order', { ascending: true });

  if (error) throw error;
  return data || [];
}

// 有効なコマ種別のみ取得
export async function getActiveAttendanceTypes(schoolId: string): Promise<AttendanceType[]> {
  const { data, error } = await supabase
    .from('attendance_types')
    .select('*')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) throw error;
  return data || [];
}

// コマ種別を作成
export async function createAttendanceType(
  schoolId: string,
  formData: AttendanceTypeFormData
): Promise<AttendanceType> {
  const { data, error } = await supabase
    .from('attendance_types')
    .insert({
      school_id: schoolId,
      ...formData,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// コマ種別を更新
export async function updateAttendanceType(
  id: string,
  formData: Partial<AttendanceTypeFormData>
): Promise<AttendanceType> {
  const { data, error } = await supabase
    .from('attendance_types')
    .update(formData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// コマ種別を削除
export async function deleteAttendanceType(id: string): Promise<void> {
  const { error } = await supabase
    .from('attendance_types')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// 表示順を一括更新
export async function updateAttendanceTypeOrder(
  items: { id: string; display_order: number }[]
): Promise<void> {
  const { error } = await supabase.rpc('update_attendance_type_order', {
    items: JSON.stringify(items),
  });

  if (error) {
    // RPCがない場合は個別更新
    for (const item of items) {
      await supabase
        .from('attendance_types')
        .update({ display_order: item.display_order })
        .eq('id', item.id);
    }
  }
}
