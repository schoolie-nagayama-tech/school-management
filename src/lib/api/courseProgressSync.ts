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

  // 該当教室のアクティブな生徒を取得。大型塾では 1000 名を超えうるため、
  // PostgREST のデフォルト上限で静かに切り捨てられて同期対象が漏れないよう、
  // .order('id').range() で 1000 件ずつ全件ページング取得する。
  const PAGE_SIZE = 1000;
  const students: { id: string; last_name: string; first_name: string }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page } = await supabase
      .from('students')
      .select('id, last_name, first_name')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    const rows = (page || []) as { id: string; last_name: string; first_name: string }[];
    students.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  if (students.length === 0) {
    return { synced: 0, skipped: 0, notFound: [] };
  }

  let synced = 0;
  let skipped = 0;
  const notFound: string[] = [];

  // 1. イベントからマッチした生徒IDを集約（同一生徒の重複は1件に）
  const matchedStudentIds = new Set<string>();
  for (const event of calendarEvents) {
    const text = `${event.summary || ''} ${event.description || ''}`;
    const matched = students.find(
      (s: { id: string; last_name: string; first_name: string }) =>
        text.includes(`${s.last_name}${s.first_name}`) ||
        text.includes(`${s.last_name} ${s.first_name}`)
    );

    if (!matched) {
      const eventLabel = event.summary || '（タイトルなし）';
      if (!notFound.includes(eventLabel)) notFound.push(eventLabel);
      continue;
    }
    matchedStudentIds.add(matched.id);
  }

  if (matchedStudentIds.size === 0) {
    return { synced, skipped, notFound };
  }

  const itemList = items as Array<{ id: string; name: string }>;
  const studentIdList = Array.from(matchedStudentIds);
  const itemIds = itemList.map((it) => it.id);

  // 2. 既存進捗を一括取得（生徒×項目ごとの select を1クエリにまとめる）
  const { data: existingRows } = await db
    .from('course_prep_student_progress')
    .select('student_id, item_id, status')
    .in('student_id', studentIdList)
    .in('item_id', itemIds);

  const statusMap = new Map<string, string>();
  for (const row of (existingRows || []) as Array<{ student_id: string; item_id: string; status: string }>) {
    statusMap.set(`${row.student_id}|${row.item_id}`, row.status);
  }

  // 3. 未完了の (生徒, 項目) のみ完了にするペイロードを構築
  const payload: Array<{ school_id: string; student_id: string; item_id: string; status: string }> = [];
  for (const studentId of studentIdList) {
    for (const item of itemList) {
      if (statusMap.get(`${studentId}|${item.id}`) === 'completed') {
        skipped++;
        continue;
      }
      payload.push({ school_id: schoolId, student_id: studentId, item_id: item.id, status: 'completed' });
      synced++;
    }
  }

  // 4. 1回の upsert でまとめて完了登録（(student_id, item_id) で衝突解決）
  if (payload.length > 0) {
    const { error } = await db
      .from('course_prep_student_progress')
      .upsert(payload, { onConflict: 'student_id,item_id' });
    if (error) throw new Error(`進捗の同期に失敗: ${error.message}`);
  }

  return { synced, skipped, notFound };
}
