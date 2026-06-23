/**
 * 試験範囲 API (student_textbook_exam_ranges)
 * 教科書 × 試験名 に対する項目範囲。試験目標とは独立した別エンティティ。
 */

import { createSupabaseBrowserClient } from '@/lib/supabase';
import type {
  StudentTextbookExamRange,
  StudentTextbookExamRangeInsert,
  StudentTextbookExamRangeUpdate,
} from '@/types/database';

type AnyClient = ReturnType<typeof createSupabaseBrowserClient>;
const client = (): AnyClient => createSupabaseBrowserClient();

/** 教科書の試験範囲を一覧取得 */
export async function getExamRanges(
  studentTextbookId: string
): Promise<StudentTextbookExamRange[]> {
  const { data, error } = await (client() as any)
    .from('student_textbook_exam_ranges')
    .select('*')
    .eq('student_textbook_id', studentTextbookId);
  if (error) throw error;
  return (data ?? []) as StudentTextbookExamRange[];
}

/**
 * 試験範囲を新規作成（常に INSERT）。
 * 同一 (student_textbook_id, exam_type_id) でも複数レコードを許容し、
 * 「単元が飛ぶ」試験範囲（例: 1-3 と 8-10）を表現できる。
 */
export async function createExamRange(
  payload: StudentTextbookExamRangeInsert
): Promise<StudentTextbookExamRange> {
  const { data, error } = await (client() as any)
    .from('student_textbook_exam_ranges')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data as StudentTextbookExamRange;
}

/**
 * 試験範囲を保存。
 * - `payload.id` があれば更新
 * - 無ければ新規作成（INSERT）
 * 互換性のため既存の関数名を維持。
 */
export async function upsertExamRange(
  payload: StudentTextbookExamRangeInsert & { id?: string }
): Promise<StudentTextbookExamRange> {
  if (payload.id) {
    const { id, ...patch } = payload;
    return updateExamRange(id, patch);
  }
  return createExamRange(payload);
}

export async function updateExamRange(
  id: string,
  patch: StudentTextbookExamRangeUpdate
): Promise<StudentTextbookExamRange> {
  const { data, error } = await (client() as any)
    .from('student_textbook_exam_ranges')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as StudentTextbookExamRange;
}

export async function deleteExamRange(id: string): Promise<void> {
  const { error } = await (client() as any)
    .from('student_textbook_exam_ranges')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
