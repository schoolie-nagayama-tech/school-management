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
 * Googleカレンダー予約データから面談申込の進捗を同期
 *
 * 処理フロー:
 * 1. Server API（/api/courses/progress/sync-calendar）経由で呼ばれる
 * 2. Google Calendar APIから面談予約イベントを取得
 * 3. イベントのタイトル/説明から生徒名を抽出
 * 4. 該当生徒の「面談申込」進捗項目を自動で完了にする
 *
 * @returns 同期結果（更新件数等）
 */
export async function syncCalendarBookingsToProgress(
  schoolId: string,
  calendarEvents: Array<{
    summary: string;
    description?: string;
    start?: string;
  }>
): Promise<{ synced: number; skipped: number; notFound: string[] }> {
  const season = getCurrentSeason();
  const year = new Date().getFullYear();

  // 「面談申込」を含む進捗項目を検索
  const { data: items } = await db
    .from('course_prep_progress_items')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year)
    .like('name', '%面談申込%');

  if (!items || items.length === 0) {
    return { synced: 0, skipped: 0, notFound: [] };
  }

  // 該当教室のアクティブな生徒を取得
  const { data: students } = await supabase
    .from('students')
    .select('id, last_name, first_name')
    .eq('school_id', schoolId)
    .eq('status', 'active');

  if (!students || students.length === 0) {
    return { synced: 0, skipped: 0, notFound: [] };
  }

  let synced = 0;
  let skipped = 0;
  const notFound: string[] = [];

  for (const event of calendarEvents) {
    // イベントのタイトルや説明から生徒名をマッチング
    const text = `${event.summary || ''} ${event.description || ''}`;
    const matched = students.find(
      (s: { id: string; last_name: string; first_name: string }) =>
        text.includes(`${s.last_name}${s.first_name}`) ||
        text.includes(`${s.last_name} ${s.first_name}`)
    );

    if (!matched) {
      // 生徒名が見つからない場合は記録してスキップ
      const eventLabel = event.summary || '（タイトルなし）';
      if (!notFound.includes(eventLabel)) {
        notFound.push(eventLabel);
      }
      continue;
    }

    for (const item of items as Array<{ id: string; name: string }>) {
      const { data: existing } = await db
        .from('course_prep_student_progress')
        .select('id, status')
        .eq('student_id', matched.id)
        .eq('item_id', item.id)
        .maybeSingle();

      if (existing?.status === 'completed') {
        skipped++;
        continue;
      }

      if (existing) {
        await db
          .from('course_prep_student_progress')
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await db
          .from('course_prep_student_progress')
          .insert({
            school_id: schoolId,
            student_id: matched.id,
            item_id: item.id,
            status: 'completed',
          });
      }
      synced++;
    }
  }

  return { synced, skipped, notFound };
}
