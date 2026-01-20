import { supabase } from '@/lib/supabase';
import { getSchoolByCode } from '@/lib/api/schools';
import type { AttendanceType, AttendanceTypeFormData, AttendanceSheet } from '@/types/attendance';

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

  if (error) {
    console.error('Error fetching attendance types:', error);
    throw new Error('コマ種別の取得に失敗しました');
  }
  return (data || []) as AttendanceType[];
}

// 有効なコマ種別のみ取得
export async function getActiveAttendanceTypes(schoolId: string): Promise<AttendanceType[]> {
  const { data, error } = await supabase
    .from('attendance_types')
    .select('*')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) {
    console.error('Error fetching active attendance types:', error);
    throw new Error('コマ種別の取得に失敗しました');
  }
  return (data || []) as AttendanceType[];
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

  if (error) {
    console.error('Error creating attendance type:', error);
    throw new Error('コマ種別の作成に失敗しました');
  }
  return data as AttendanceType;
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

  if (error) {
    console.error('Error updating attendance type:', error);
    throw new Error('コマ種別の更新に失敗しました');
  }
  return data as AttendanceType;
}

// コマ種別を削除
export async function deleteAttendanceType(id: string): Promise<void> {
  const { error } = await supabase
    .from('attendance_types')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting attendance type:', error);
    throw new Error('コマ種別の削除に失敗しました');
  }
}

// 表示順を一括更新
export async function updateAttendanceTypeOrder(
  items: { id: string; display_order: number }[]
): Promise<void> {
  // RPCがない場合は個別更新
  for (const item of items) {
    const { error } = await supabase
      .from('attendance_types')
      .update({ display_order: item.display_order })
      .eq('id', item.id);
    
    if (error) {
      console.error('Error updating attendance type order:', error);
      throw new Error('表示順の更新に失敗しました');
    }
  }
}

// ========================================
// 出勤簿 API
// ========================================

// 教室の講師一覧を取得（出勤簿ステータス付き）
export async function getTeachersWithAttendance(
  schoolId: string,
  yearMonth: string
) {
  // 教室に紐づく講師ユーザーを取得（user_profiles + user_schools）
  const { data: userSchools, error: userSchoolsError } = await supabase
    .from('user_schools')
    .select('user_id')
    .eq('school_id', schoolId);

  if (userSchoolsError) {
    console.error('Error fetching user_schools:', userSchoolsError);
    throw new Error('講師一覧の取得に失敗しました');
  }

  const teacherIds = Array.from(new Set((userSchools || []).map((u) => u.user_id).filter(Boolean)));
  if (teacherIds.length === 0) return [];

  const { data: teacherProfiles, error: teachersError } = await supabase
    .from('user_profiles')
    .select('id, display_name, email, role, is_active')
    .in('id', teacherIds)
    .eq('role', 'teacher')
    .eq('is_active', true);

  if (teachersError) {
    console.error('Error fetching teachers:', teachersError);
    throw new Error('講師一覧の取得に失敗しました');
  }

  const teachers =
    teacherProfiles?.map((t) => ({
      id: t.id,
      name: t.display_name || t.email || '未設定',
    })) || [];

  // 出勤簿を取得
  const { data: sheets, error: sheetsError } = await supabase
    .from('attendance_sheets')
    .select('*')
    .eq('school_id', schoolId)
    .eq('year_month', yearMonth);

  if (sheetsError) {
    console.error('Error fetching attendance sheets:', sheetsError);
    throw new Error('出勤簿の取得に失敗しました');
  }

  // コマ種別を取得
  const { data: types, error: typesError } = await supabase
    .from('attendance_types')
    .select('id')
    .eq('school_id', schoolId)
    .eq('is_active', true);

  if (typesError) {
    console.error('Error fetching attendance types:', typesError);
    throw new Error('コマ種別の取得に失敗しました');
  }

  // 講師ごとの合計を計算
  const result = await Promise.all(
    (teachers || []).map(async (teacher) => {
      const sheet = sheets?.find((s) => s.teacher_id === teacher.id);
      
      let totalCount = 0;
      if (sheet) {
        const { data: records } = await supabase
          .from('attendance_records')
          .select('value')
          .eq('sheet_id', sheet.id);
        
        totalCount = records?.reduce((sum, r) => sum + Number(r.value), 0) || 0;
      }

      return {
        ...teacher,
        sheet_id: sheet?.id || null,
        status: sheet?.status || 'draft',
        total_count: totalCount,
      };
    })
  );

  return result;
}

// 出勤簿を取得または作成
export async function getOrCreateAttendanceSheet(
  teacherId: string,
  schoolId: string,
  yearMonth: string
): Promise<AttendanceSheet> {
  // 既存の出勤簿を検索
  const { data: existing, error: findError } = await supabase
    .from('attendance_sheets')
    .select('*')
    .eq('teacher_id', teacherId)
    .eq('school_id', schoolId)
    .eq('year_month', yearMonth)
    .maybeSingle();

  if (existing) {
    return existing as AttendanceSheet;
  }
  
  if (findError && findError.code !== 'PGRST116') {
    console.error('Error finding attendance sheet:', findError);
    throw new Error('出勤簿の検索に失敗しました');
  }

  // なければ作成
  const { data: created, error: createError } = await supabase
    .from('attendance_sheets')
    .insert({
      teacher_id: teacherId,
      school_id: schoolId,
      year_month: yearMonth,
      status: 'draft',
    })
    .select()
    .single();

  if (createError) {
    console.error('Error creating attendance sheet:', createError);
    throw new Error('出勤簿の作成に失敗しました');
  }
  return created as AttendanceSheet;
}

// 出勤簿の詳細を取得（明細・備考含む）
export async function getAttendanceSheetDetail(sheetId: string) {
  const { data: sheet, error: sheetError } = await supabase
    .from('attendance_sheets')
    .select('*')
    .eq('id', sheetId)
    .single();

  if (sheetError) {
    console.error('Error fetching attendance sheet:', sheetError);
    throw new Error('出勤簿の取得に失敗しました');
  }

  // 講師情報
  let teacher: { id: string; name: string } | null = null;
  if (sheet.teacher_id) {
    const { data: teacherData, error: teacherError } = await supabase
      .from('user_profiles')
      .select('id, display_name, email')
      .eq('id', sheet.teacher_id)
      .maybeSingle();
    if (teacherError) {
      console.error('Error fetching teacher:', teacherError);
    } else {
      teacher = teacherData
        ? {
            id: teacherData.id,
            name: teacherData.display_name || teacherData.email || '未設定',
          }
        : null;
    }
  }

  // 教室情報
  let school: { id: string; name: string; code: string | null } | null = null;
  if (sheet.school_id) {
    const { data: schoolData, error: schoolError } = await supabase
      .from('schools')
      .select('id, name, code')
      .eq('id', sheet.school_id)
      .maybeSingle();
    if (schoolError) {
      console.error('Error fetching school:', schoolError);
    } else {
      school = schoolData || null;
    }
  }

  const { data: records, error: recordsError } = await supabase
    .from('attendance_records')
    .select(`
      *,
      attendance_type:attendance_types(*)
    `)
    .eq('sheet_id', sheetId);

  if (recordsError) {
    console.error('Error fetching attendance records:', recordsError);
    throw new Error('出勤簿明細の取得に失敗しました');
  }

  const { data: notes, error: notesError } = await supabase
    .from('attendance_notes')
    .select('*')
    .eq('sheet_id', sheetId);

  if (notesError) {
    console.error('Error fetching attendance notes:', notesError);
    throw new Error('備考の取得に失敗しました');
  }

  return {
    sheet: {
      ...sheet,
      teacher,
      school,
    },
    records: records || [],
    notes: notes || [],
  };
}

// 出勤簿明細を保存（upsert）
export async function saveAttendanceRecord(
  sheetId: string,
  date: string,
  attendanceTypeId: string,
  value: number
) {
  const { data, error } = await supabase
    .from('attendance_records')
    .upsert(
      {
        sheet_id: sheetId,
        date,
        attendance_type_id: attendanceTypeId,
        value,
      },
      {
        onConflict: 'sheet_id,date,attendance_type_id',
      }
    )
    .select()
    .single();

  if (error) {
    console.error('Error saving attendance record:', error);
    throw new Error('出勤簿明細の保存に失敗しました');
  }
  return data;
}

// 遅刻早退・備考を保存（upsert）
export async function saveAttendanceNote(
  sheetId: string,
  date: string,
  lateEarly: string | null,
  note: string | null
) {
  // 両方空なら削除
  if (!lateEarly && !note) {
    const { error } = await supabase
      .from('attendance_notes')
      .delete()
      .eq('sheet_id', sheetId)
      .eq('date', date);
    
    if (error) {
      console.error('Error deleting attendance note:', error);
      throw new Error('備考の削除に失敗しました');
    }
    return null;
  }

  const { data, error } = await supabase
    .from('attendance_notes')
    .upsert(
      {
        sheet_id: sheetId,
        date,
        late_early: lateEarly,
        note,
      },
      {
        onConflict: 'sheet_id,date',
      }
    )
    .select()
    .single();

  if (error) {
    console.error('Error saving attendance note:', error);
    throw new Error('備考の保存に失敗しました');
  }
  return data;
}

// 出勤簿を提出
export async function submitAttendanceSheet(sheetId: string) {
  const { data, error } = await supabase
    .from('attendance_sheets')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    })
    .eq('id', sheetId)
    .select()
    .single();

  if (error) {
    console.error('Error submitting attendance sheet:', error);
    throw new Error('出勤簿の提出に失敗しました');
  }
  return data;
}

// 出勤簿を取り下げ（提出取消）
export async function withdrawAttendanceSheet(sheetId: string) {
  const { data, error } = await supabase
    .from('attendance_sheets')
    .update({
      status: 'draft',
      submitted_at: null,
    })
    .eq('id', sheetId)
    .eq('status', 'submitted') // 承認待ちの場合のみ
    .select()
    .single();

  if (error) {
    console.error('Error withdrawing attendance sheet:', error);
    throw new Error('出勤簿の取り下げに失敗しました');
  }
  return data;
}

// ========================================
// 管理画面用 API
// ========================================

// 教室の出勤簿一覧を取得（管理画面用）
export async function getAttendanceSheetList(
  schoolId: string,
  yearMonth: string
) {
  const { data, error } = await supabase
    .from('attendance_sheets')
    .select('*')
    .eq('school_id', schoolId)
    .eq('year_month', yearMonth)
    .order('teacher_id');

  if (error) {
    console.error('Error fetching attendance sheet list:', error);
    throw new Error('出勤簿一覧の取得に失敗しました');
  }

  // 講師情報をまとめて取得
  const teacherIds = Array.from(new Set((data || []).map((s) => s.teacher_id).filter(Boolean)));
  let teacherMap: Record<string, { id: string; name: string }> = {};
  if (teacherIds.length > 0) {
    const { data: teacherData, error: teacherError } = await supabase
      .from('user_profiles')
      .select('id, display_name, email')
      .in('id', teacherIds);
    if (teacherError) {
      console.error('Error fetching teachers:', teacherError);
    } else {
      teacherMap = Object.fromEntries(
        (teacherData || []).map((t) => [
          t.id,
          { id: t.id, name: t.display_name || t.email || '未設定' },
        ])
      );
    }
  }

  // 承認者情報をまとめて取得
  const approverIds = Array.from(new Set((data || []).map((s: any) => s.approved_by).filter(Boolean)));
  let approverMap: Record<string, { id: string; display_name: string | null }> = {};
  if (approverIds.length > 0) {
    const { data: approverData, error: approverError } = await supabase
      .from('user_profiles')
      .select('id, display_name')
      .in('id', approverIds);
    if (approverError) {
      console.error('Error fetching approvers:', approverError);
    } else {
      approverMap = Object.fromEntries((approverData || []).map((u) => [u.id, u]));
    }
  }

  // 各シートの合計を計算
  const result = await Promise.all(
    (data || []).map(async (sheet) => {
      const { data: records } = await supabase
        .from('attendance_records')
        .select(`
          value,
          attendance_type:attendance_types(id, name, unit)
        `)
        .eq('sheet_id', sheet.id);

      // 種別ごとの合計を計算
      const typeTotals: Record<string, { name: string; unit: string; total: number }> = {};
      records?.forEach((r: any) => {
        const typeId = r.attendance_type?.id;
        if (!typeId) return;
        
        if (!typeTotals[typeId]) {
          typeTotals[typeId] = {
            name: r.attendance_type.name,
            unit: r.attendance_type.unit,
            total: 0,
          };
        }
        typeTotals[typeId].total += Number(r.value);
      });

      const grandTotal = Object.values(typeTotals).reduce(
        (sum, t) => sum + t.total,
        0
      );

      return {
        ...sheet,
        teacher: teacherMap[sheet.teacher_id] || null,
        approved_by_user: sheet.approved_by ? approverMap[sheet.approved_by] || null : null,
        type_totals: typeTotals,
        grand_total: grandTotal,
      };
    })
  );

  return result;
}

// 出勤簿を承認
export async function approveAttendanceSheet(
  sheetId: string,
  approvedBy: string
) {
  const { data, error } = await supabase
    .from('attendance_sheets')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
      rejection_reason: null,
    })
    .eq('id', sheetId)
    .select()
    .single();

  if (error) {
    console.error('Error approving attendance sheet:', error);
    throw new Error('出勤簿の承認に失敗しました');
  }
  return data;
}

// 出勤簿を差し戻し
export async function rejectAttendanceSheet(
  sheetId: string,
  reason: string
) {
  const { data, error } = await supabase
    .from('attendance_sheets')
    .update({
      status: 'rejected',
      rejection_reason: reason,
    })
    .eq('id', sheetId)
    .select()
    .single();

  if (error) {
    console.error('Error rejecting attendance sheet:', error);
    throw new Error('出勤簿の差し戻しに失敗しました');
  }
  return data;
}

// 出勤簿を一括承認
export async function bulkApproveAttendanceSheets(
  sheetIds: string[],
  approvedBy: string
) {
  const { data, error } = await supabase
    .from('attendance_sheets')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
      rejection_reason: null,
    })
    .in('id', sheetIds)
    .eq('status', 'submitted')
    .select();

  if (error) {
    console.error('Error bulk approving attendance sheets:', error);
    throw new Error('一括承認に失敗しました');
  }
  return data;
}

// 出勤簿のステータスを入力中に戻す（承認取消）
export async function reopenAttendanceSheet(sheetId: string) {
  const { data, error } = await supabase
    .from('attendance_sheets')
    .update({
      status: 'draft',
      submitted_at: null,
      approved_at: null,
      approved_by: null,
      rejection_reason: null,
    })
    .eq('id', sheetId)
    .select()
    .single();

  if (error) {
    console.error('Error reopening attendance sheet:', error);
    throw new Error('承認取消に失敗しました');
  }
  return data;
}

// ========================================
// 集計・レポート用 API
// ========================================

// 月次集計データを取得
export async function getAttendanceSummary(
  schoolId: string | null,
  yearMonth: string
) {
  let query = supabase
    .from('attendance_sheets')
    .select('*')
    .eq('year_month', yearMonth);

  if (schoolId) {
    query = query.eq('school_id', schoolId);
  }

  const { data: sheets, error: sheetsError } = await query;
  if (sheetsError) {
    console.error('Error fetching attendance sheets:', sheetsError);
    throw new Error('出勤簿の取得に失敗しました');
  }

  // 講師情報をまとめて取得
  const teacherIds = Array.from(new Set((sheets || []).map((s: any) => s.teacher_id).filter(Boolean)));
  let teacherMap: Record<string, { id: string; name: string }> = {};
  if (teacherIds.length > 0) {
    const { data: teacherData, error: teacherError } = await supabase
      .from('user_profiles')
      .select('id, display_name, email')
      .in('id', teacherIds);
    if (teacherError) {
      console.error('Error fetching teachers:', teacherError);
    } else {
      teacherMap = Object.fromEntries(
        (teacherData || []).map((t) => [
          t.id,
          { id: t.id, name: t.display_name || t.email || '未設定' },
        ])
      );
    }
  }

  // 教室情報をまとめて取得
  const schoolIds = Array.from(new Set((sheets || []).map((s: any) => s.school_id).filter(Boolean)));
  let schoolMap: Record<string, { id: string; name: string; code: string | null }> = {};
  if (schoolIds.length > 0) {
    const { data: schoolData, error: schoolError } = await supabase
      .from('schools')
      .select('id, name, code')
      .in('id', schoolIds);
    if (schoolError) {
      console.error('Error fetching schools:', schoolError);
    } else {
      schoolMap = Object.fromEntries((schoolData || []).map((s) => [s.id, s]));
    }
  }

  // 各シートの詳細を取得
  const result = await Promise.all(
    (sheets || []).map(async (sheet) => {
      // 明細を取得
      const { data: records } = await supabase
        .from('attendance_records')
        .select(`
          value,
          attendance_type:attendance_types(id, name, unit, unit_price)
        `)
        .eq('sheet_id', sheet.id);

      // 種別ごとの合計と金額を計算
      const typeTotals: Record<string, {
        name: string;
        unit: string;
        unit_price: number;
        total: number;
        amount: number;
      }> = {};

      records?.forEach((r: any) => {
        const type = r.attendance_type;
        if (!type) return;

        if (!typeTotals[type.id]) {
          typeTotals[type.id] = {
            name: type.name,
            unit: type.unit,
            unit_price: type.unit_price,
            total: 0,
            amount: 0,
          };
        }
        const value = Number(r.value);
        typeTotals[type.id].total += value;
        typeTotals[type.id].amount += value * type.unit_price;
      });

      const grandTotal = Object.values(typeTotals).reduce((sum, t) => sum + t.total, 0);
      const totalAmount = Object.values(typeTotals).reduce((sum, t) => sum + t.amount, 0);

      return {
        ...sheet,
        teacher: sheet.teacher_id ? teacherMap[sheet.teacher_id] || null : null,
        school: sheet.school_id ? schoolMap[sheet.school_id] || null : null,
        type_totals: typeTotals,
        grand_total: grandTotal,
        total_amount: totalAmount,
      };
    })
  );

  return result;
}

// 遅刻早退一覧を取得
export async function getLateEarlyList(
  schoolId: string | null,
  yearMonth: string
) {
  // まず対象の出勤簿を取得
  let sheetsQuery = supabase
    .from('attendance_sheets')
    .select('id, teacher_id, school_id')
    .eq('year_month', yearMonth);

  if (schoolId) {
    sheetsQuery = sheetsQuery.eq('school_id', schoolId);
  }

  const { data: sheets, error: sheetsError } = await sheetsQuery;
  if (sheetsError) {
    console.error('Error fetching attendance sheets:', sheetsError);
    throw new Error('出勤簿の取得に失敗しました');
  }

  if (!sheets || sheets.length === 0) return [];

  const sheetIds = sheets.map((s) => s.id);

  // 講師と教室のマップを作成
  const teacherIds = Array.from(new Set(sheets.map((s: any) => s.teacher_id).filter(Boolean)));
  let teacherMap: Record<string, { id: string; name: string }> = {};
  if (teacherIds.length > 0) {
    const { data: teachers, error: teacherError } = await supabase
      .from('user_profiles')
      .select('id, display_name, email')
      .in('id', teacherIds);
    if (teacherError) {
      console.error('Error fetching teachers:', teacherError);
    } else {
      teacherMap = Object.fromEntries(
        (teachers || []).map((t) => [
          t.id,
          { id: t.id, name: t.display_name || t.email || '未設定' },
        ])
      );
    }
  }

  const schoolIds = Array.from(new Set(sheets.map((s: any) => s.school_id).filter(Boolean)));
  let schoolMap: Record<string, { id: string; name: string }> = {};
  if (schoolIds.length > 0) {
    const { data: schoolsData, error: schoolError } = await supabase
      .from('schools')
      .select('id, name')
      .in('id', schoolIds);
    if (schoolError) {
      console.error('Error fetching schools:', schoolError);
    } else {
      schoolMap = Object.fromEntries((schoolsData || []).map((s) => [s.id, s]));
    }
  }

  // 遅刻早退データを取得
  const { data: notes, error: notesError } = await supabase
    .from('attendance_notes')
    .select('*')
    .in('sheet_id', sheetIds)
    .not('late_early', 'is', null)
    .neq('late_early', '')
    .order('date', { ascending: true });

  if (notesError) {
    console.error('Error fetching late early list:', notesError);
    throw new Error('遅刻早退データの取得に失敗しました');
  }

  // ノートにシート・講師・教室情報を付与
  return (notes || []).map((note) => {
    const sheet = sheets.find((s) => s.id === note.sheet_id);
    const teacher = sheet?.teacher_id ? teacherMap[sheet.teacher_id] || null : null;
    const school = sheet?.school_id ? schoolMap[sheet.school_id] || null : null;
    return {
      ...note,
      sheet: {
        id: sheet?.id || note.sheet_id,
        teacher,
        school,
      },
    };
  });
}

// 全教室のコマ種別を取得（集計用）
export async function getAllAttendanceTypes(schoolIds?: string[]) {
  let query = supabase
    .from('attendance_types')
    .select(`
      *,
      school:schools(id, name)
    `)
    .eq('is_active', true)
    .order('display_order');

  if (schoolIds && schoolIds.length > 0) {
    query = query.in('school_id', schoolIds);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching all attendance types:', error);
    throw new Error('コマ種別の取得に失敗しました');
  }
  return (data || []) as AttendanceType[];
}
