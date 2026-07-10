// 生徒×科目の指導契約（1対1/1対2）の CRUD。
//
// Phase R。student_subject_contracts テーブル（student_id × subject_id → ratio）が正のソース。
// 通塾日程・座席表の ratio 初期値をここから引く。既存の受講科目リスト student_subjects とは別テーブル
// （student_subjects は編集のたび delete-all→re-insert される破壊的置換で ratio を載せられないため分離）。
//
// school_id はアプリ側でセットする（RLS check_school_access と一覧高速化用）。

import { supabase } from '@/lib/supabase';

// 座席表系テーブルと同じく Database 型未追加のため any でクエリ
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface StudentSubjectContract {
  id: string;
  school_id: string;
  student_id: string;
  subject_id: string;
  ratio: 1 | 2;
  created_at: string;
  updated_at: string;
}

/**
 * 生徒の全科目契約を取得し subject_id → ratio のマップで返す。
 * フォームで科目を選んだときに ratio 初期値を引く用途。
 */
export async function getStudentContractRatioMap(studentId: string): Promise<Map<string, 1 | 2>> {
  const { data, error } = await db
    .from('student_subject_contracts')
    .select('subject_id, ratio')
    .eq('student_id', studentId);
  if (error) {
    console.error('Error fetching student subject contracts:', error);
    // 契約が引けなくても登録フロー自体は止めない（既定 ratio=2 で運用継続）。
    return new Map();
  }
  const map = new Map<string, 1 | 2>();
  for (const r of (data ?? []) as Array<{ subject_id: string; ratio: number }>) {
    map.set(r.subject_id, r.ratio === 1 ? 1 : 2);
  }
  return map;
}

/**
 * 契約を upsert（生徒×科目で一意）。フォームで比率を変更したときに契約側も正として更新する。
 * @param schoolId 生徒の所属校（呼び出し側でセット）
 */
export async function upsertStudentContract(
  schoolId: string,
  studentId: string,
  subjectId: string,
  ratio: 1 | 2
): Promise<void> {
  const { error } = await db.from('student_subject_contracts').upsert(
    {
      school_id: schoolId,
      student_id: studentId,
      subject_id: subjectId,
      ratio,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,subject_id' }
  );
  if (error) {
    console.error('Error upserting student subject contract:', error);
    throw new Error('指導契約（1対1/1対2）の保存に失敗しました');
  }
}
