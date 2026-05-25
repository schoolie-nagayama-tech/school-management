// 授業生徒数設定（school_class_capacity）の CRUD
//
// 学校ごとの授業生徒数上限（個別/集団それぞれ）を管理するための API。
// マイグレーションで全スクールにデフォルト値の行をシード済みのため、
// 通常は getByScoolId で取得 → updateByScoolId で更新するだけで運用できる。

import { supabase } from '@/lib/supabase';
import type { SchoolClassCapacity, SchoolClassCapacityFormData } from '@/types/schedule';

// 座席表系テーブルと同じく、新規テーブルは Database 型に未追加なので any でクエリ
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** 学校のデフォルト値（マイグレーションのDEFAULTと一致させる） */
export const DEFAULT_CLASS_CAPACITY: SchoolClassCapacityFormData = {
  max_students_per_teacher_individual: 2,
  total_individual_seats: 12,
  max_students_per_group: 8,
  max_concurrent_groups: 1,
};

/**
 * 学校の授業生徒数設定を取得。
 * 行が存在しない場合（古いスクール等）はデフォルト値の DTO を返す（行は作らない）。
 */
export async function getClassCapacity(schoolId: string): Promise<SchoolClassCapacity | null> {
  const { data, error } = await db
    .from('school_class_capacity')
    .select('*')
    .eq('school_id', schoolId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching class capacity:', error);
    throw new Error('授業生徒数設定の取得に失敗しました');
  }
  return (data as SchoolClassCapacity) ?? null;
}

/**
 * 学校の授業生徒数設定を取得。無ければデフォルト値で1件作成して返す。
 * 設定画面で初回アクセス時に呼ぶ用途。
 */
export async function getOrCreateClassCapacity(schoolId: string): Promise<SchoolClassCapacity> {
  const existing = await getClassCapacity(schoolId);
  if (existing) return existing;

  const { data, error } = await db
    .from('school_class_capacity')
    .insert({ school_id: schoolId, ...DEFAULT_CLASS_CAPACITY })
    .select()
    .single();

  if (error) {
    console.error('Error creating default class capacity:', error);
    throw new Error('授業生徒数設定の初期化に失敗しました');
  }
  return data as SchoolClassCapacity;
}

/** 学校の授業生徒数設定を更新（無ければ upsert） */
export async function upsertClassCapacity(
  schoolId: string,
  form: SchoolClassCapacityFormData
): Promise<SchoolClassCapacity> {
  // 入力バリデーション（DBチェック制約と二重ガード）
  if (form.max_students_per_teacher_individual < 1 || form.max_students_per_teacher_individual > 10) {
    throw new Error('1講師あたりの生徒数は 1〜10 の範囲で入力してください');
  }
  if (form.total_individual_seats < 1 || form.total_individual_seats > 100) {
    throw new Error('教室全体の同時席数は 1〜100 の範囲で入力してください');
  }
  if (form.max_students_per_group < 1 || form.max_students_per_group > 100) {
    throw new Error('集団1コマあたりの生徒数は 1〜100 の範囲で入力してください');
  }
  if (form.max_concurrent_groups < 1 || form.max_concurrent_groups > 20) {
    throw new Error('同時開催コマ数は 1〜20 の範囲で入力してください');
  }

  const { data, error } = await db
    .from('school_class_capacity')
    .upsert(
      { school_id: schoolId, ...form },
      { onConflict: 'school_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('Error upserting class capacity:', error);
    throw new Error('授業生徒数設定の更新に失敗しました');
  }
  return data as SchoolClassCapacity;
}
