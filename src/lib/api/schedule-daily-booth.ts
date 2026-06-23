// 日次の講師ブース番号割当 API
//
// 印刷用の座席表で、講師名の隣にブース番号 (1, 2, ...) を出すための情報を扱う。
// 1日 × 1講師 = 1レコード。同日内では番号の重複は不可（DB の UNIQUE で強制）。

import { supabase } from '@/lib/supabase';

// 新規テーブルなので Database 型に未追加。any でクエリ。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface DailyBoothAssignment {
  id: string;
  school_id: string;
  assignment_date: string;
  teacher_id: string;
  booth_no: number;
  created_at: string;
  updated_at: string;
}

/** 指定日のブース割当一覧を取得（番号順） */
export async function getDailyBoothAssignments(
  schoolId: string,
  date: string
): Promise<DailyBoothAssignment[]> {
  const { data, error } = await db
    .from('schedule_daily_booth_assignments')
    .select('*')
    .eq('school_id', schoolId)
    .eq('assignment_date', date)
    .order('booth_no', { ascending: true });

  if (error) {
    console.error('Error fetching daily booth assignments:', error);
    throw new Error('ブース番号の取得に失敗しました');
  }
  return (data || []) as DailyBoothAssignment[];
}

/**
 * 指定日のブース割当を一括設定（既存を全置換）。
 * 「番号設定モーダル」で講師→番号の対応を編集 → 保存ボタンで一発置換するための関数。
 */
export async function setDailyBoothAssignments(
  schoolId: string,
  date: string,
  assignments: Array<{ teacher_id: string; booth_no: number }>
): Promise<DailyBoothAssignment[]> {
  // 入力バリデーション
  if (assignments.length === 0) {
    // 0件指定なら、その日の割当を全削除
    await db
      .from('schedule_daily_booth_assignments')
      .delete()
      .eq('school_id', schoolId)
      .eq('assignment_date', date);
    return [];
  }

  const booths = assignments.map((a) => a.booth_no);
  const teachers = assignments.map((a) => a.teacher_id);
  if (new Set(booths).size !== booths.length) {
    throw new Error('同じブース番号が複数の講師に割り当てられています');
  }
  if (new Set(teachers).size !== teachers.length) {
    throw new Error('同じ講師に複数のブース番号が割り当てられています');
  }

  // 既存を全削除 → 新規にまとめてinsert
  // （UNIQUE制約があるので部分的なupsertだと衝突する可能性。シンプルに置換で運用）
  const { error: delError } = await db
    .from('schedule_daily_booth_assignments')
    .delete()
    .eq('school_id', schoolId)
    .eq('assignment_date', date);
  if (delError) {
    console.error('Error clearing existing booth assignments:', delError);
    throw new Error('既存ブース割当の削除に失敗しました');
  }

  const rows = assignments.map((a) => ({
    school_id: schoolId,
    assignment_date: date,
    teacher_id: a.teacher_id,
    booth_no: a.booth_no,
  }));

  const { data, error } = await db.from('schedule_daily_booth_assignments').insert(rows).select();

  if (error) {
    console.error('Error inserting booth assignments:', error);
    throw new Error('ブース番号の保存に失敗しました');
  }
  return (data || []) as DailyBoothAssignment[];
}

/**
 * 指定日の (講師ID → ブース番号) マップを返す。
 * 印刷ビューで講師名の隣に番号を表示するための便利関数。
 */
export async function getBoothNoMapForDate(
  schoolId: string,
  date: string
): Promise<Map<string, number>> {
  const assignments = await getDailyBoothAssignments(schoolId, date);
  const map = new Map<string, number>();
  for (const a of assignments) {
    map.set(a.teacher_id, a.booth_no);
  }
  return map;
}
