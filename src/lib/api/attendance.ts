import { supabase } from '@/lib/supabase';
import { fetchAllPaged, fetchAllInChunks } from '@/lib/utils/supabasePaging';
import type {
  AttendanceType,
  AttendanceTypeFormData,
  AttendanceSheet,
  AttendanceSheetStatus,
  AttendanceRecord,
  AttendanceNote,
  KomaChangeInput,
} from '@/types/attendance';

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
  const { error } = await supabase.from('attendance_types').delete().eq('id', id);

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
export async function getTeachersWithAttendance(schoolId: string, yearMonth: string) {
  // 教室に紐づく講師ユーザーを取得（user_profiles + user_schools）
  const { data: userSchools, error: userSchoolsError } = await supabase
    .from('user_schools')
    .select('user_id')
    .eq('school_id', schoolId);

  if (userSchoolsError) {
    console.error('Error fetching user_schools:', userSchoolsError);
    throw new Error('講師一覧の取得に失敗しました');
  }

  const teacherIds = Array.from(
    new Set(
      (userSchools || [])
        .map((u: { user_id?: string }) => u.user_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (teacherIds.length === 0) return [];

  // user_profiles と attendance_sheets は互いに独立 → 並列化
  // role='teacher' に加え、is_teaching_staff=true のユーザーも出勤簿対象とする
  // （owner/admin などロール兼任でも授業を持つ場合に対応）
  const [profilesRes, sheetsRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('id, display_name, email, role, is_active, is_teaching_staff')
      .in('id', teacherIds)
      .or('role.eq.teacher,is_teaching_staff.eq.true')
      .eq('is_active', true),
    supabase
      .from('attendance_sheets')
      .select('*')
      .eq('school_id', schoolId)
      .eq('year_month', yearMonth),
  ]);

  if (profilesRes.error) {
    console.error('Error fetching teachers:', profilesRes.error);
    throw new Error('講師一覧の取得に失敗しました');
  }
  if (sheetsRes.error) {
    console.error('Error fetching attendance sheets:', sheetsRes.error);
    throw new Error('出勤簿の取得に失敗しました');
  }

  const teachers =
    profilesRes.data?.map((t) => ({
      id: t.id,
      name: t.display_name || t.email || '未設定',
    })) || [];

  const sheets = (sheetsRes.data || []) as AttendanceSheet[];

  // 全シートの出勤レコードを一括取得
  const allSheetIds = (sheets || []).map((s) => s.id);
  const recordsBySheet = new Map<string, any[]>();
  if (allSheetIds.length > 0) {
    // records は (シート × 日数 × 種別) で1000行を容易に超える。sheetIds も多いと
    // .in() の URL が長くなるため、チャンク分割 + チャンク内ページングで取得する。
    const allRecords = await fetchAllInChunks<{ sheet_id: string; value: number }>(
      allSheetIds,
      (chunk, from, to) =>
        supabase
          .from('attendance_records')
          .select('sheet_id, value')
          .in('sheet_id', chunk)
          .order('id', { ascending: true })
          .range(from, to)
    );
    allRecords.forEach((r) => {
      const list = recordsBySheet.get(r.sheet_id) || [];
      list.push(r);
      recordsBySheet.set(r.sheet_id, list);
    });
  }

  // 講師ごとの合計を計算
  const result = (teachers || []).map((teacher) => {
    const sheet = sheets?.find((s) => s.teacher_id === teacher.id);

    let totalCount = 0;
    if (sheet) {
      const records = recordsBySheet.get(sheet.id) || [];
      totalCount = records.reduce((sum, r) => sum + Number(r.value), 0);
    }

    return {
      ...teacher,
      sheet_id: sheet?.id || null,
      status: sheet?.status || 'draft',
      total_count: totalCount,
    };
  });

  return result;
}

// 出勤簿を取得（存在しなければ null、作成はしない）
export async function findAttendanceSheet(
  teacherId: string,
  schoolId: string,
  yearMonth: string
): Promise<AttendanceSheet | null> {
  const { data, error } = await supabase
    .from('attendance_sheets')
    .select('*')
    .eq('teacher_id', teacherId)
    .eq('school_id', schoolId)
    .eq('year_month', yearMonth)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') {
    console.error('Error finding attendance sheet:', error);
    return null;
  }
  return (data as AttendanceSheet) || null;
}

// 出勤簿を取得または作成
/**
 * ★ 新規作成は「その講師がその教室に所属しているとき」だけ。
 *   このページ(/attendance/[schoolCode]/[teacherId])は開いただけでシートを作るため、
 *   所属していない教室のURLを踏むと空シートが生えていた。掛け持ちの講師は教室ごとに
 *   別アカウントで運用しているので、旧アカウント側に他教室のシートが残ると
 *   出勤簿一覧（attendance_sheets 起点）に同じ氏名が2行並ぶ。
 *   実例: 若林 佐知子（永山アカウントに堀之内のシートが残り2行表示 / 2026-08 に削除）。
 *
 * ★ 既存シートは所属を見ずにそのまま返す。異動などで所属が変わっても、
 *   過去に作られたシートの閲覧・提出まで塞いでしまわないようにするため。
 */
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

  // 所属確認。user_schools は本人か管理者ロールしか読めない（RLS）ので、
  // 読めなかった場合も「作らない」側に倒す。
  const { data: membership, error: membershipError } = await supabase
    .from('user_schools')
    .select('school_id')
    .eq('user_id', teacherId)
    .eq('school_id', schoolId)
    .limit(1);

  if (membershipError) {
    console.error('Error checking user_schools:', membershipError);
    throw new Error('出勤簿の作成に失敗しました');
  }
  if (!membership || membership.length === 0) {
    throw new Error('この教室に所属していないため、出勤簿を作成できません');
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

/** 未提出の出勤簿（講師本人用）。sheetId が null なら出勤簿がまだ作られていない＝当然未提出。 */
export interface UnsubmittedAttendanceTarget {
  schoolId: string;
  sheetId: string | null;
  status: AttendanceSheetStatus | null;
}

/**
 * 指定月の出勤簿がまだ提出されていない教室を返す（講師本人の未提出ゲート用）。
 *
 * 未提出とみなすのは次の3つ:
 *   - 出勤簿がまだ無い（一度も開いていない）
 *   - draft（下書きのまま提出していない）
 *   - rejected（差し戻された。直して出し直す必要がある）
 * submitted 以降（submitted / reviewed / approved）は本人の手を離れているので対象外。
 *
 * ★ 取得に失敗したときは空配列を返す（＝ブロックしない）。
 *   判定できないことを理由に業務を止める側へは倒さない。
 */
export async function getUnsubmittedAttendanceSheets(
  teacherId: string,
  schoolIds: string[],
  yearMonth: string
): Promise<UnsubmittedAttendanceTarget[]> {
  if (!teacherId || schoolIds.length === 0) return [];

  const { data, error } = await supabase
    .from('attendance_sheets')
    .select('id, school_id, status')
    .eq('teacher_id', teacherId)
    .in('school_id', schoolIds)
    .eq('year_month', yearMonth);

  if (error) {
    console.error('Error checking unsubmitted attendance sheets:', error);
    return [];
  }

  const bySchool = new Map<string, { id: string; status: AttendanceSheetStatus }>();
  for (const row of (data || []) as {
    id: string;
    school_id: string;
    status: AttendanceSheetStatus;
  }[]) {
    bySchool.set(row.school_id, { id: row.id, status: row.status });
  }

  return schoolIds
    .map((schoolId) => {
      const sheet = bySchool.get(schoolId);
      return {
        schoolId,
        sheetId: sheet?.id ?? null,
        status: sheet?.status ?? null,
      };
    })
    .filter((t) => t.status === null || t.status === 'draft' || t.status === 'rejected');
}

// 出勤簿の詳細を取得（明細・備考含む）
export async function getAttendanceSheetDetail(sheetId: string) {
  const { data: sheetData, error: sheetError } = await supabase
    .from('attendance_sheets')
    .select('*')
    .eq('id', sheetId)
    .single();

  if (sheetError || !sheetData) {
    console.error('Error fetching attendance sheet:', sheetError);
    throw new Error('出勤簿の取得に失敗しました');
  }
  const sheet = sheetData as AttendanceSheet;

  // 講師・教室・明細・備考を並列取得
  const [teacherRes, schoolRes, recordsRes, notesRes] = await Promise.all([
    sheet.teacher_id
      ? supabase
          .from('user_profiles')
          .select('id, display_name, email')
          .eq('id', sheet.teacher_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as const),
    sheet.school_id
      ? supabase.from('schools').select('id, name, code').eq('id', sheet.school_id).maybeSingle()
      : Promise.resolve({ data: null, error: null } as const),
    supabase
      .from('attendance_records')
      .select(
        `
        *,
        attendance_type:attendance_types(*)
      `
      )
      .eq('sheet_id', sheetId),
    supabase.from('attendance_notes').select('*').eq('sheet_id', sheetId),
  ]);

  if (recordsRes.error) {
    console.error('Error fetching attendance records:', recordsRes.error);
    throw new Error('出勤簿明細の取得に失敗しました');
  }
  if (notesRes.error) {
    console.error('Error fetching attendance notes:', notesRes.error);
    throw new Error('備考の取得に失敗しました');
  }
  if (teacherRes.error) console.error('Error fetching teacher:', teacherRes.error);
  if (schoolRes.error) console.error('Error fetching school:', schoolRes.error);

  const teacher = teacherRes.data
    ? {
        id: teacherRes.data.id,
        name: teacherRes.data.display_name || teacherRes.data.email || '未設定',
      }
    : null;
  const school = schoolRes.data || null;
  const records = recordsRes.data;
  const notes = notesRes.data;

  return {
    sheet: {
      ...sheet,
      teacher,
      school,
    },
    records: (records || []) as AttendanceRecord[],
    notes: (notes || []) as AttendanceNote[],
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
/**
 * 対象月の在籍講師に、出勤簿（下書き）が無ければ作成する。
 *
 * ★ なぜ必要か: 一覧は attendance_sheets 起点なので、シートが1枚も無い講師は行が存在せず
 *   一覧に出てこなかった。運用上は「使い始める前に出勤簿を書いてもらう」ため、
 *   登録済みの講師は未入力でも一覧に並んでいる必要がある。
 *
 * ★ 在籍していた月だけに作る（「当月以降」では絞らない）:
 *   この画面の既定は前月（給与の確認・承認は前月分を見る運用）。当月以降に限ると、
 *   肝心の前月一覧に新任講師が出ずに目的を果たせない。代わりに次の2点で絞る。
 *   - アカウント作成が対象月より後の講師は作らない（その月にはまだ居なかった）
 *   - 対象月の開始より前に退職済みの講師は作らない
 *   hire_date は未設定が多く判定に使えないため、created_at を在籍の代理指標にしている。
 *
 * UNIQUE(teacher_id, school_id, year_month) があるため、同時に開かれても重複しない
 * （ignoreDuplicates で衝突は黙って捨てる）。
 */
async function ensureSheetsForActiveTeachers(schoolId: string, yearMonth: string): Promise<void> {
  const { data: userSchools } = await supabase
    .from('user_schools')
    .select('user_id')
    .eq('school_id', schoolId);
  const teacherIds = Array.from(
    new Set(
      (userSchools || [])
        .map((u: { user_id?: string }) => u.user_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (teacherIds.length === 0) return;

  // 一覧の対象講師は getTeachersWithAttendance と同じ条件で揃える
  const [y, m] = yearMonth.split('-').map(Number);
  const monthStart = `${yearMonth}-01`;
  const monthEnd = `${yearMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('id, exit_date, created_at')
    .in('id', teacherIds)
    .or('role.eq.teacher,is_teaching_staff.eq.true')
    .eq('is_active', true);

  const targets = (profiles || [])
    .filter((p) => {
      const { exit_date: exit, created_at: created } = p as {
        exit_date: string | null;
        created_at: string | null;
      };
      if (exit && exit < monthStart) return false; // 対象月より前に退職済み
      if (created && created.slice(0, 10) > monthEnd) return false; // その月にはまだ居なかった
      return true;
    })
    .map((p) => (p as { id: string }).id);
  if (targets.length === 0) return;

  const { data: existing } = await supabase
    .from('attendance_sheets')
    .select('teacher_id')
    .eq('school_id', schoolId)
    .eq('year_month', yearMonth);
  const has = new Set((existing || []).map((s: { teacher_id: string }) => s.teacher_id));

  const missing = targets.filter((id) => !has.has(id));
  if (missing.length === 0) return;

  const { error } = await supabase.from('attendance_sheets').upsert(
    missing.map((teacherId) => ({
      teacher_id: teacherId,
      school_id: schoolId,
      year_month: yearMonth,
      status: 'draft' as const,
    })),
    { onConflict: 'teacher_id,school_id,year_month', ignoreDuplicates: true }
  );
  // 作成に失敗しても一覧表示自体は続行する（既存分は出す）
  if (error) console.error('Error creating draft attendance sheets:', error);
}

/**
 * 自分が次に動かすべき出勤簿の件数（お知らせバー・ヘッダーバッジ用）。
 *
 * ★ 出勤簿には通知の受け口が無く、管理者は出勤簿管理を開くまで
 *   提出されたことに気づけなかった。件数だけ外に出して気づけるようにする。
 *
 * ★ 役割で対象ステータスが変わる（画面の actionableStatuses と同じ定義に揃えること）:
 *   - 教室長: submitted（講師から出てきた。確認して管理者へ提出する）
 *   - 管理者/オーナー: submitted + reviewed（承認する）
 *
 * ★ 月では絞らない: 承認漏れは古い月ほど埋もれるため、未処理は全部数える。
 *
 * @returns 件数（教室が無い/権限が無い場合は 0）
 */
export async function getPendingAttendanceCount(
  schoolIds: string[],
  role: string | null | undefined
): Promise<number> {
  if (schoolIds.length === 0) return 0;
  const r = (role ?? '').toLowerCase();
  if (r !== 'manager' && r !== 'admin' && r !== 'owner') return 0;
  const statuses: AttendanceSheetStatus[] =
    r === 'manager' ? ['submitted'] : ['submitted', 'reviewed'];

  const { count, error } = await supabase
    .from('attendance_sheets')
    .select('id', { count: 'exact', head: true })
    .in('school_id', schoolIds)
    .in('status', statuses);

  if (error) {
    console.error('Error counting pending attendance sheets:', error);
    return 0;
  }
  return count ?? 0;
}

export async function getAttendanceSheetList(schoolId: string, yearMonth: string) {
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

  const sheets = (data || []) as AttendanceSheet[];
  // 講師情報をまとめて取得（exit_date は退職状態表示に使用）
  const teacherIds = Array.from(new Set(sheets.map((s) => s.teacher_id).filter(Boolean)));
  let teacherMap: Record<
    string,
    { id: string; name: string; employee_no: string | null; exit_date: string | null }
  > = {};
  if (teacherIds.length > 0) {
    const { data: teacherData, error: teacherError } = await supabase
      .from('user_profiles')
      .select('id, display_name, email, employee_no, exit_date')
      .in('id', teacherIds);
    if (teacherError) {
      console.error('Error fetching teachers:', teacherError);
    } else {
      teacherMap = Object.fromEntries(
        (teacherData || []).map((t) => [
          t.id,
          {
            id: t.id,
            name: t.display_name || t.email || '未設定',
            employee_no: t.employee_no ?? null,
            exit_date: t.exit_date ?? null,
          },
        ])
      );
    }
  }

  // 承認者情報をまとめて取得
  const approverIds = Array.from(
    new Set(sheets.map((s) => s.approved_by).filter((id): id is string => Boolean(id)))
  );
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

  // 全シートの出勤レコードを一括取得
  const allSheetIds = sheets.map((s) => s.id);
  const recordsBySheet2 = new Map<string, any[]>();
  if (allSheetIds.length > 0) {
    // records は (シート × 日数 × 種別) で1000行を容易に超える。sheetIds も多いと
    // .in() の URL が長くなるため、チャンク分割 + チャンク内ページングで取得する。
    const allRecords = await fetchAllInChunks<Record<string, unknown>>(
      allSheetIds,
      (chunk, from, to) =>
        supabase
          .from('attendance_records')
          .select(
            `
        sheet_id,
        value,
        attendance_type:attendance_types(id, name, unit)
      `
          )
          .in('sheet_id', chunk)
          .order('id', { ascending: true })
          .range(from, to)
    );
    allRecords.forEach((r: Record<string, unknown>) => {
      const list = recordsBySheet2.get(r.sheet_id as string) || [];
      list.push(r);
      recordsBySheet2.set(r.sheet_id as string, list);
    });
  }

  // 各シートの合計を計算
  const result = sheets.map((sheet) => {
    const records = recordsBySheet2.get(sheet.id) || [];

    // 種別ごとの合計を計算
    const typeTotals: Record<string, { name: string; unit: string; total: number }> = {};
    records.forEach((r: Record<string, unknown>) => {
      const type = r.attendance_type as { id: string; name: string; unit: string } | null;
      if (!type?.id) return;

      if (!typeTotals[type.id]) {
        typeTotals[type.id] = {
          name: type.name,
          unit: type.unit,
          total: 0,
        };
      }
      typeTotals[type.id].total += Number(r.value);
    });

    const grandTotal = Object.values(typeTotals).reduce((sum, t) => sum + t.total, 0);

    return {
      ...sheet,
      teacher: teacherMap[sheet.teacher_id] || null,
      approved_by_user: sheet.approved_by ? approverMap[sheet.approved_by] || null : null,
      type_totals: typeTotals,
      grand_total: grandTotal,
    };
  });

  return result;
}

// 出勤簿を承認
export async function approveAttendanceSheet(sheetId: string, approvedBy: string) {
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
export async function rejectAttendanceSheet(sheetId: string, reason: string) {
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

// 出勤簿を一括承認（管理者: reviewed → approved）
export async function bulkApproveAttendanceSheets(sheetIds: string[], approvedBy: string) {
  const { data, error } = await supabase
    .from('attendance_sheets')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
      rejection_reason: null,
    })
    .in('id', sheetIds)
    .in('status', ['submitted', 'reviewed'])
    .select();

  if (error) {
    console.error('Error bulk approving attendance sheets:', error);
    throw new Error('一括承認に失敗しました');
  }
  return data;
}

// 教室長が管理者へ一括提出（submitted → reviewed）
export async function reviewAttendanceSheets(
  sheetIds: string[],
  reviewedBy: string,
  submittedTo: string
) {
  const { data, error } = await supabase
    .from('attendance_sheets')
    .update({
      status: 'reviewed',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
      submitted_to: submittedTo,
      rejection_reason: null,
    })
    .in('id', sheetIds)
    .eq('status', 'submitted')
    .select();

  if (error) {
    console.error('Error reviewing attendance sheets:', error);
    throw new Error('一括提出に失敗しました');
  }
  return data;
}

// 教室長が講師に差し戻し（submitted → rejected）
export async function rejectToTeacher(sheetId: string, reason: string) {
  const { data, error } = await supabase
    .from('attendance_sheets')
    .update({
      status: 'rejected',
      rejection_reason: reason,
    })
    .eq('id', sheetId)
    .eq('status', 'submitted')
    .select()
    .single();

  if (error) {
    console.error('Error rejecting to teacher:', error);
    throw new Error('差し戻しに失敗しました');
  }
  return data;
}

// 管理者が教室長に差し戻し（reviewed → submitted）
export async function rejectToManager(sheetId: string, reason: string) {
  const { data, error } = await supabase
    .from('attendance_sheets')
    .update({
      status: 'submitted',
      reviewed_at: null,
      reviewed_by: null,
      submitted_to: null,
      rejection_reason: reason,
    })
    .eq('id', sheetId)
    .eq('status', 'reviewed')
    .select()
    .single();

  if (error) {
    console.error('Error rejecting to manager:', error);
    throw new Error('差し戻しに失敗しました');
  }
  return data;
}

// 出勤簿のステータスを戻す（承認取消: approved → reviewed）
export async function reopenAttendanceSheet(sheetId: string) {
  const { data, error } = await supabase
    .from('attendance_sheets')
    .update({
      status: 'reviewed',
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

// 管理者一覧を取得（提出先選択用）
/**
 * 出勤簿の提出先の候補（教室長が「管理者へ提出」するときに選ぶ相手）。
 *
 * ★ admin のみ。以前は owner も候補に含めていたが、承認するのは管理者なので
 *   提出先も管理者に揃える（オーナーを選べると、承認されないまま止まりうる）。
 *
 * ★ @test.com のテストアカウントは除外する。本番にも admin@test.com 等が実在し、
 *   全教室に紐づいているため候補に出てしまう。アカウント自体は動作確認に使うので
 *   is_active は落とさず、この一覧からだけ隠す。
 */
export async function getAdminUsers() {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, display_name, email')
    .eq('role', 'admin')
    .eq('is_active', true)
    .not('email', 'like', '%@test.com')
    .order('display_name');

  if (error) {
    console.error('Error fetching admin users:', error);
    return [];
  }
  return (data || []).map((u) => ({
    id: u.id,
    name: u.display_name || u.email || '未設定',
  }));
}

// ========================================
// 集計・レポート用 API
// ========================================

// 月次集計データを取得
// schoolId が null のときは allowedSchoolIds で絞る（未指定なら全件＝管理者用）
export async function getAttendanceSummary(
  schoolId: string | null,
  yearMonth: string,
  allowedSchoolIds?: string[]
) {
  // 未入力の講師も一覧に出すため、先に下書きを用意する。
  // 教室が特定できるときだけ（全教室表示では対象が広すぎて作成の副作用が大きい）。
  if (schoolId) {
    await ensureSheetsForActiveTeachers(schoolId, yearMonth);
  }

  // 出勤簿は (教室 × 講師) で、全教室指定(管理者)だと1000行に接近しうる。records の
  // 元になるため切り捨てると集計全体が欠けるので全件ページング取得（id 昇順で安定）。
  let sheets: AttendanceSheet[];
  try {
    sheets = await fetchAllPaged<AttendanceSheet>((from, to) => {
      let query = supabase.from('attendance_sheets').select('*').eq('year_month', yearMonth);
      if (schoolId) {
        query = query.eq('school_id', schoolId);
      } else if (allowedSchoolIds && allowedSchoolIds.length > 0) {
        query = query.in('school_id', allowedSchoolIds);
      } else {
        // 全教室指定だが allowedSchoolIds が空 → 権限なしのため0件
        query = query.eq('school_id', '00000000-0000-0000-0000-000000000000');
      }
      return query.order('id', { ascending: true }).range(from, to);
    });
  } catch (sheetsError) {
    console.error('Error fetching attendance sheets:', sheetsError);
    throw new Error('出勤簿の取得に失敗しました');
  }

  // 講師情報をまとめて取得（employee_no は出勤簿一覧の並び順に、exit_date は退職状態表示に使用）
  const teacherIds = Array.from(new Set(sheets.map((s) => s.teacher_id).filter(Boolean)));
  let teacherMap: Record<
    string,
    { id: string; name: string; employee_no: string | null; exit_date: string | null }
  > = {};
  if (teacherIds.length > 0) {
    const { data: teacherData, error: teacherError } = await supabase
      .from('user_profiles')
      .select('id, display_name, email, employee_no, exit_date')
      .in('id', teacherIds);
    if (teacherError) {
      console.error('Error fetching teachers:', teacherError);
    } else {
      teacherMap = Object.fromEntries(
        (teacherData || []).map((t) => [
          t.id,
          {
            id: t.id,
            name: t.display_name || t.email || '未設定',
            employee_no: t.employee_no ?? null,
            exit_date: t.exit_date ?? null,
          },
        ])
      );
    }
  }

  // 教室情報をまとめて取得
  const schoolIds = Array.from(new Set(sheets.map((s) => s.school_id).filter(Boolean)));
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

  // 全シートの出勤レコードを一括取得（is_class_type を含む）
  const summarySheetIds = sheets.map((s) => s.id);
  const recordsBySheet3 = new Map<string, any[]>();
  if (summarySheetIds.length > 0) {
    // records は (シート × 日数 × 種別) で1000行を容易に超える。sheetIds も多いと
    // .in() の URL が長くなるため、チャンク分割 + チャンク内ページングで取得する。
    const allRecords = await fetchAllInChunks<Record<string, unknown>>(
      summarySheetIds,
      (chunk, from, to) =>
        supabase
          .from('attendance_records')
          .select(
            `
        sheet_id,
        date,
        value,
        attendance_type:attendance_types(id, name, unit, unit_price, is_class_type)
      `
          )
          .in('sheet_id', chunk)
          .order('id', { ascending: true })
          .range(from, to)
    );
    allRecords.forEach((r) => {
      const list = recordsBySheet3.get(r.sheet_id as string) || [];
      list.push(r);
      recordsBySheet3.set(r.sheet_id as string, list);
    });
  }

  // 各シートの詳細を計算
  const result = sheets.map((sheet) => {
    const records = recordsBySheet3.get(sheet.id) || [];

    // 種別ごとの合計と金額を計算
    const typeTotals: Record<
      string,
      {
        name: string;
        unit: string;
        unit_price: number;
        total: number;
        amount: number;
      }
    > = {};

    const classDates = new Set<string>();
    const allWorkDates = new Set<string>();

    records.forEach((r: Record<string, unknown>) => {
      const type = r.attendance_type as {
        id: string;
        name: string;
        unit: string;
        unit_price: number;
        is_class_type: boolean;
      } | null;
      if (!type) return;
      const value = Number(r.value);
      if (value === 0) return;

      if (!typeTotals[type.id]) {
        typeTotals[type.id] = {
          name: type.name,
          unit: type.unit,
          unit_price: type.unit_price,
          total: 0,
          amount: 0,
        };
      }
      typeTotals[type.id].total += value;
      typeTotals[type.id].amount += value * type.unit_price;

      const date = r.date as string;
      allWorkDates.add(date);
      if (type.is_class_type) {
        classDates.add(date);
      }
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
      prep_days: classDates.size,
      work_days: allWorkDates.size,
    };
  });

  return result;
}

// 遅刻早退一覧を取得
export async function getLateEarlyList(schoolId: string | null, yearMonth: string) {
  // まず対象の出勤簿を取得
  // 出勤簿は (教室 × 講師) で全教室指定だと1000行に接近しうるため全件ページング取得
  // （id 昇順で安定）。notes の元になるので切り捨てると遅刻早退が欠落する。
  let sheets: Pick<AttendanceSheet, 'id' | 'teacher_id' | 'school_id'>[];
  try {
    sheets = await fetchAllPaged<Pick<AttendanceSheet, 'id' | 'teacher_id' | 'school_id'>>(
      (from, to) => {
        let sheetsQuery = supabase
          .from('attendance_sheets')
          .select('id, teacher_id, school_id')
          .eq('year_month', yearMonth);
        if (schoolId) sheetsQuery = sheetsQuery.eq('school_id', schoolId);
        return sheetsQuery.order('id', { ascending: true }).range(from, to);
      }
    );
  } catch (sheetsError) {
    console.error('Error fetching attendance sheets:', sheetsError);
    throw new Error('出勤簿の取得に失敗しました');
  }

  if (sheets.length === 0) return [];

  const sheetIds = sheets.map((s) => s.id);

  // 講師と教室のマップを作成
  const teacherIds = Array.from(new Set(sheets.map((s) => s.teacher_id).filter(Boolean)));
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

  const schoolIds = Array.from(new Set(sheets.map((s) => s.school_id).filter(Boolean)));
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

  // 遅刻早退データを取得。全教室・全講師分でスケールし、sheetIds も多いと .in() の
  // URL が長くなるため、チャンク分割 + チャンク内ページングで取得する（id 昇順で安定）。
  let typedNotes: AttendanceNote[];
  try {
    typedNotes = await fetchAllInChunks<AttendanceNote>(sheetIds, (chunk, from, to) =>
      supabase
        .from('attendance_notes')
        .select('*')
        .in('sheet_id', chunk)
        .not('late_early', 'is', null)
        .neq('late_early', '')
        .order('id', { ascending: true })
        .range(from, to)
    );
  } catch (notesError) {
    console.error('Error fetching late early list:', notesError);
    throw new Error('遅刻早退データの取得に失敗しました');
  }
  // チャンク分割で失われる全体の日付順を復元（元は .order('date') で日付昇順を返していた）
  typedNotes.sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));
  return typedNotes.map((note) => {
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
    .select(
      `
      *,
      school:schools(id, name)
    `
    )
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

// ========================================
// 出勤簿 管理者入力 API
// ========================================

// 交通費・備考・コマ給変更フラグを更新
export async function updateAttendanceSheetMeta(
  sheetId: string,
  fields: {
    transport_cost?: number;
    admin_note?: string | null;
    is_koma_changing?: boolean;
    koma_change_from?: number | null;
    koma_change_to?: number | null;
    koma_change_from_1to1?: number | null;
    koma_change_to_1to1?: number | null;
  }
) {
  const { error } = await supabase.from('attendance_sheets').update(fields).eq('id', sheetId);

  if (error) {
    console.error('Error updating attendance sheet meta:', error);
    throw new Error('出勤簿の更新に失敗しました');
  }
}

// コマ給変更を登録/解除（講師の所属教室すべてに反映、シートがなければ作成）。
// 指導形態ごと（1対2 / 1対1）に独立して設定でき、両枠とも空なら解除扱い。
export async function setKomaChange(
  teacherId: string,
  yearMonth: string,
  allowedSchoolIds: string[],
  change: KomaChangeInput
) {
  if (allowedSchoolIds.length === 0) return;

  const { data: userSchools } = await supabase
    .from('user_schools')
    .select('school_id')
    .eq('user_id', teacherId)
    .in('school_id', allowedSchoolIds);
  const teacherSchoolIds = Array.from(
    new Set(
      (userSchools || [])
        .map((u: { school_id?: string }) => u.school_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  if (teacherSchoolIds.length === 0) return;

  for (const sId of teacherSchoolIds) {
    await getOrCreateAttendanceSheet(teacherId, sId, yearMonth);
  }

  // 各枠は from/to が揃って初めて有効。片方だけの入力は未設定として捨てる。
  const has1to2 = change.from_1to2 !== null && change.to_1to2 !== null;
  const has1to1 = change.from_1to1 !== null && change.to_1to1 !== null;
  const { error } = await supabase
    .from('attendance_sheets')
    .update({
      is_koma_changing: has1to2 || has1to1,
      koma_change_from: has1to2 ? change.from_1to2 : null,
      koma_change_to: has1to2 ? change.to_1to2 : null,
      koma_change_from_1to1: has1to1 ? change.from_1to1 : null,
      koma_change_to_1to1: has1to1 ? change.to_1to1 : null,
    })
    .eq('teacher_id', teacherId)
    .eq('year_month', yearMonth)
    .in('school_id', teacherSchoolIds);
  if (error) {
    console.error('Error setting koma change:', error);
    throw new Error('コマ給変更の保存に失敗しました');
  }
}

// 講師の退職日を更新
export async function updateTeacherExitDate(teacherId: string, exitDate: string | null) {
  const { error } = await supabase
    .from('user_profiles')
    .update({ exit_date: exitDate })
    .eq('id', teacherId);

  if (error) {
    console.error('Error updating exit date:', error);
    throw new Error('退職日の更新に失敗しました');
  }
}

// 講師の社員番号を更新（出勤簿一覧からのインライン編集用）。空文字は NULL に正規化。
export async function updateTeacherEmployeeNo(teacherId: string, employeeNo: string | null) {
  const value = employeeNo && employeeNo.trim() !== '' ? employeeNo.trim() : null;
  const { error } = await supabase
    .from('user_profiles')
    .update({ employee_no: value })
    .eq('id', teacherId);

  if (error) {
    console.error('Error updating employee_no:', error);
    throw new Error('社員番号の更新に失敗しました');
  }
}

// 先月退職した講師を取得
export async function getRecentlyRetiredTeachers(schoolIds: string[], yearMonth: string) {
  const [y, m] = yearMonth.split('-').map(Number);
  const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const prevStart = `${prevMonth}-01`;
  const prevEnd =
    m === 1
      ? `${y - 1}-12-31`
      : `${y}-${String(m - 1).padStart(2, '0')}-${new Date(y, m - 1, 0).getDate()}`;

  if (schoolIds.length === 0) return [];

  const { data: userSchools } = await supabase
    .from('user_schools')
    .select('user_id')
    .in('school_id', schoolIds);
  const teacherIds = Array.from(
    new Set(
      (userSchools || [])
        .map((u: { user_id?: string }) => u.user_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (teacherIds.length === 0) return [];

  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, display_name, email, exit_date')
    .in('id', teacherIds)
    .eq('role', 'teacher')
    .gte('exit_date', prevStart)
    .lte('exit_date', prevEnd);

  if (error) {
    console.error('Error fetching retired teachers:', error);
    return [];
  }
  return (data || []).map((t) => ({
    id: t.id,
    name: t.display_name || t.email || '未設定',
    exit_date: t.exit_date ?? null,
  }));
}

// 入社して約3ヶ月の講師を取得（＝3ヶ月前の月に入社した講師）。
// 判定は user_profiles.hire_date（入社日）で行う。created_at はアカウント作成日であって入社日ではなく、
// 導入時の一括投入で全員同日になってしまうため使わない。hire_date が NULL の講師は対象外。
export async function getNewTeachers(schoolIds: string[], yearMonth: string) {
  const [y, m] = yearMonth.split('-').map(Number);
  let targetMonth = m - 3;
  let targetYear = y;
  if (targetMonth <= 0) {
    targetMonth += 12;
    targetYear -= 1;
  }
  const targetStart = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
  const targetEnd = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${new Date(targetYear, targetMonth, 0).getDate()}`;

  if (schoolIds.length === 0) return [];

  const { data: userSchools } = await supabase
    .from('user_schools')
    .select('user_id')
    .in('school_id', schoolIds);
  const teacherIds = Array.from(
    new Set(
      (userSchools || [])
        .map((u: { user_id?: string }) => u.user_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (teacherIds.length === 0) return [];

  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, display_name, email, hire_date')
    .in('id', teacherIds)
    .eq('role', 'teacher')
    .eq('is_active', true)
    .gte('hire_date', targetStart)
    .lte('hire_date', targetEnd);

  if (error) {
    console.error('Error fetching new teachers:', error);
    return [];
  }
  return (data || []).map((t) => ({
    id: t.id,
    name: t.display_name || t.email || '未設定',
    hire_date: t.hire_date as string,
  }));
}

// 講師の入社日を更新（出勤簿管理からのインライン設定用）
export async function updateTeacherHireDate(teacherId: string, hireDate: string | null) {
  const { error } = await supabase
    .from('user_profiles')
    .update({ hire_date: hireDate })
    .eq('id', teacherId);

  if (error) {
    console.error('Error updating hire_date:', error);
    throw new Error('入社日の更新に失敗しました');
  }
}

// 教室に紐づく active 講師一覧（ドロップダウン選択肢用）
export async function getActiveTeacherProfiles(schoolIds: string[]) {
  if (schoolIds.length === 0) return [];

  const { data: userSchools } = await supabase
    .from('user_schools')
    .select('user_id')
    .in('school_id', schoolIds);
  const teacherIds = Array.from(
    new Set(
      (userSchools || [])
        .map((u: { user_id?: string }) => u.user_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (teacherIds.length === 0) return [];

  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, display_name, email, exit_date, hire_date, created_at')
    .in('id', teacherIds)
    // 出勤簿管理の講師ドロップダウン。role='teacher' に加え時給講師(is_teaching_staff)も対象にする
    .or('role.eq.teacher,is_teaching_staff.eq.true')
    .eq('is_active', true)
    .order('display_name');

  if (error) {
    console.error('Error fetching active teacher profiles:', error);
    return [];
  }
  return (data || []).map((t) => ({
    id: t.id,
    name: t.display_name || t.email || '未設定',
    exit_date: t.exit_date as string | null,
    hire_date: (t.hire_date as string | null) ?? null,
    created_at: t.created_at,
  }));
}
