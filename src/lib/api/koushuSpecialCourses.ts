/**
 * 特別講座（小集団・HAL 等）マスタ (koushu_special_courses) の API。
 *
 * 仕様書 §18（決定55〜58）:
 *  - seasonal_courses（個別指導の学習メニュー・959件現役）とは別テーブル。混ぜない
 *  - formation は schedule_formations の is_system=false（ユーザー定義）を使う
 *  - 開催予定（session_dates）は固定・振替不可。座席表への反映は手動配置（決定2は不変）
 *
 * koushu_special_courses は生成型（src/types/database.ts）に未反映のため、
 * schedule-formations.ts と同じ流儀で db を any にしてクエリする。
 */
import { supabase } from '@/lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** 開催予定1回分（配布する予定表そのもの。変更・振替はしない前提） */
export interface SpecialCourseSession {
  date: string; // 'YYYY-MM-DD'
  start_time: string; // 'HH:mm'
  end_time: string; // 'HH:mm'
}

export interface KoushuSpecialCourse {
  id: string;
  school_id: string;
  season: string;
  year: number;
  /** schedule_formations.key（is_system=false のユーザー定義形態。例: 小集団 / HAL） */
  formation: string;
  name: string;
  /** 対象学年（1-13）。空配列=全学年 */
  target_grades: number[];
  /** 1回あたりの単価（円・税込）。未設定はnull */
  unit_price: number | null;
  session_dates: SpecialCourseSession[];
  /** 定員。NULL=制限なし */
  capacity: number | null;
  is_active: boolean;
}

const SELECT_COLUMNS =
  'id, school_id, season, year, formation, name, target_grades, unit_price, session_dates, capacity, is_active';

/**
 * 教室×講習期間（season+year）の特別講座一覧を取得。
 * 並び順は形態→講座名（形態タブごとにまとまって見える方が編集しやすいため）。
 */
export async function getSpecialCourses(
  schoolId: string,
  season: string,
  year: number
): Promise<KoushuSpecialCourse[]> {
  const { data, error } = await db
    .from('koushu_special_courses')
    .select(SELECT_COLUMNS)
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year)
    .order('formation', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    console.error('Error fetching special courses:', error);
    throw new Error('特別講座の取得に失敗しました');
  }
  return (data ?? []) as KoushuSpecialCourse[];
}

/** 特別講座を新規作成。id は DB 側で自動採番。 */
export async function createSpecialCourse(
  input: Omit<KoushuSpecialCourse, 'id' | 'school_id'> & { school_id: string }
): Promise<KoushuSpecialCourse> {
  const { data, error } = await db
    .from('koushu_special_courses')
    .insert({ ...input })
    .select(SELECT_COLUMNS)
    .single();
  if (error) {
    console.error('Error creating special course:', error);
    throw new Error('特別講座の作成に失敗しました');
  }
  return data as KoushuSpecialCourse;
}

/** 特別講座を部分更新。school_id の張り替えは想定しない（別教室への移動はできない）。 */
export async function updateSpecialCourse(
  id: string,
  patch: Partial<Omit<KoushuSpecialCourse, 'id' | 'school_id'>>
): Promise<void> {
  const { error } = await db.from('koushu_special_courses').update(patch).eq('id', id);
  if (error) {
    console.error('Error updating special course:', error);
    throw new Error('特別講座の更新に失敗しました');
  }
}

/**
 * 特別講座を削除。
 * koushu_enrollments.course_id は RESTRICT でこのテーブルを参照している（§18-4）ため、
 * 申込が1件でもあると 23503（foreign_key_violation）で失敗する。
 * その場合はユーザーに分かる日本語メッセージへ変換して投げ直す。
 */
export async function deleteSpecialCourse(id: string): Promise<void> {
  const { error } = await db.from('koushu_special_courses').delete().eq('id', id);
  if (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: string }).code)
        : '';
    if (code === '23503') {
      throw new Error('この講座には申込があるため削除できません');
    }
    console.error('Error deleting special course:', error);
    throw new Error('特別講座の削除に失敗しました');
  }
}
