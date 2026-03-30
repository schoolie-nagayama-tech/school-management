import { supabase } from '../supabase';
import type { SeasonType } from '@/types/database';

// 新規テーブルは生成型に未反映のため any キャスト
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * 現在の講習シーズンを推定
 */
function getCurrentSeason(): SeasonType {
  const month = new Date().getMonth() + 1;
  if (month >= 2 && month <= 5) return 'spring';
  if (month >= 6 && month <= 9) return 'summer';
  return 'winter';
}

/**
 * soudan（面談申込）を講習進捗に連携
 *
 * soudanフォーム回答が生徒に紐付けされたとき、
 * 該当教室の現シーズンの進捗項目「面談申込・面談日決定」を自動で完了にする
 */
export async function syncSoudanToProgress(
  schoolId: string,
  studentId: string
): Promise<void> {
  const season = getCurrentSeason();
  const year = new Date().getFullYear();

  // 「面談申込」を含む進捗項目を検索
  const { data: items, error: itemsError } = await db
    .from('course_prep_progress_items')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year)
    .like('name', '%面談申込%');

  if (itemsError || !items || items.length === 0) {
    // 該当項目がなければ何もしない（進捗管理が未設定の教室）
    return;
  }

  for (const item of items as Array<{ id: string; name: string }>) {
    // 既存データを確認
    const { data: existing } = await db
      .from('course_prep_student_progress')
      .select('id, status')
      .eq('student_id', studentId)
      .eq('item_id', item.id)
      .maybeSingle();

    if (existing?.status === 'completed') {
      // 既に完了済みなら何もしない
      continue;
    }

    if (existing) {
      // 既存レコードを完了に更新
      await db
        .from('course_prep_student_progress')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      // 新規作成して完了にする
      await db
        .from('course_prep_student_progress')
        .insert({
          school_id: schoolId,
          student_id: studentId,
          item_id: item.id,
          status: 'completed',
        });
    }
  }
}
