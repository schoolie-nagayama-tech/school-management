import type { SupabaseClient } from '@supabase/supabase-js';
import type { SeasonType } from '@/types/database';
import { SEASON_LABELS } from '@/types/database';
import {
  isInterviewBookingProgressItem,
  selectCoursePrepSyncTargetPeriod,
} from '@/lib/coursePrepKpis';

/**
 * 同期結果。
 * - periodLabel: 実際に書き込んだ期（「2026年冬期」）。画面で開いている期とは限らないので、
 *   どの期に印を付けたのかを必ず利用者に見せる。
 * - reason: 1件も同期できなかった理由。呼び出し側がそのまま画面に出す。
 */
export interface CalendarSyncResult {
  synced: number;
  skipped: number;
  notFound: string[];
  periodLabel?: string;
  reason?: string;
}

type Scope = { season: SeasonType; year: number };

function periodLabel(scope: Scope): string {
  return `${scope.year}年${SEASON_LABELS[scope.season]}`;
}

/**
 * 面談予約を書き込む期（季節・年）を、実際の日付から1つ決める。
 *
 * 以前は月だけで決めていた（2〜5月=春期／6〜9月=夏期／それ以外=冬期）ため、本番データと
 * 2つの形でずれていた。
 *  1. 準備は講習期間より前に走る。夏期2026 は期間 7/06〜8/31 に対して面談申込の期日が 5/30。
 *     9月に入っている面談予約は冬期のものなのに、月で決めると「9月だから夏期」となり、
 *     終わった夏期の「面談申込」に印が付いていた。
 *  2. 年も new Date().getFullYear() で決めていた。冬期2026 は year=2026 のまま 2027-01 まで
 *     続くので、1月になると year=2027 と一致せず、同期が黙って何もしなくなっていた。
 *
 * どの期を選ぶかの判断は純関数 selectCoursePrepSyncTargetPeriod にまとめてある。
 */
async function resolveSyncTargetPeriod(
  db: SupabaseClient,
  schoolId: string
): Promise<{ scope: Scope | null; reason?: string }> {
  // JSTの暦日で比べる。UTCの日付で比べると、JST深夜0〜9時に「終了日当日の期」が前日扱いで
  // 先に閉じてしまう（APIルートはUTCで動く）。
  const todayJST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });

  const [
    { data: periods, error: periodError },
    { data: tracks, error: trackError },
    { data: snapshots, error: snapshotError },
  ] = await Promise.all([
    db
      .from('course_prep_periods')
      .select('school_id, season, year, schedule_start_date, schedule_end_date')
      .eq('school_id', schoolId),
    db
      .from('course_prep_tracks')
      .select('school_id, season, year, schedule_end_date')
      .eq('school_id', schoolId),
    db.from('course_prep_snapshots').select('school_id, season, year').eq('school_id', schoolId),
  ]);

  // 読めなかったときは黙って0件で返さず落とす。書き込み先を1つに決める処理なので、
  // 材料が欠けたまま進めると「別の期に印を付ける」という取り返しのつかない間違いになる。
  const readError = periodError || trackError || snapshotError;
  if (readError) {
    throw new Error(`講習期間の取得に失敗: ${readError.message}`);
  }

  const scope = selectCoursePrepSyncTargetPeriod(
    periods ?? [],
    tracks ?? [],
    snapshots ?? [],
    todayJST
  );

  if (!scope) {
    return {
      scope: null,
      reason:
        '同期先の期が見つかりませんでした。講習期間（開始日・終了日）が設定された、まだ終わっていない期がありません。「講習管理」→「進捗管理」の上部「講習期間」で設定してください',
    };
  }
  return { scope };
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
 * db には呼び出し元（APIルート）の service role クライアントを渡す。ここは共有の
 * ブラウザ用クライアント（anon）を使っていたが、サーバー上ではセッションが無く auth.uid()
 * が NULL になるため、講習準備まわりのRLS（check_school_access）が全部落ちて読み書きできない。
 * ルート側で「呼び出し元がその教室を扱えるか」を検証済みなので、service role で通す。
 *
 * @returns 同期結果（更新件数等）
 */
export async function syncCalendarBookingsToProgress(
  db: SupabaseClient,
  schoolId: string,
  calendarEvents: Array<{
    summary: string;
    description?: string;
    start?: string;
  }>
): Promise<CalendarSyncResult> {
  const { scope, reason } = await resolveSyncTargetPeriod(db, schoolId);
  if (!scope) {
    return { synced: 0, skipped: 0, notFound: [], reason };
  }
  const label = periodLabel(scope);

  // 「面談申込」を含む進捗項目を検索
  const { data: rawItems, error: itemsError } = await db
    .from('course_prep_progress_items')
    .select('id, name')
    .eq('school_id', schoolId)
    .eq('season', scope.season)
    .eq('year', scope.year)
    .like('name', '%面談申込%');

  if (itemsError) {
    throw new Error(`進捗項目の取得に失敗: ${itemsError.message}`);
  }

  // 部分一致には「面談申込未提出者へ電話」のような、予約が取れた生徒については完了に
  // してはいけない項目も混じる。判定は isInterviewBookingProgressItem に寄せてある。
  const itemList = ((rawItems ?? []) as Array<{ id: string; name: string }>).filter(
    isInterviewBookingProgressItem
  );

  if (itemList.length === 0) {
    return {
      synced: 0,
      skipped: 0,
      notFound: [],
      periodLabel: label,
      reason: `${label}に「面談申込」の進捗項目がありません。進捗管理でこの期の項目を作ってから同期してください`,
    };
  }

  // 該当教室のアクティブな生徒を取得。大型塾では 1000 名を超えうるため、
  // PostgREST のデフォルト上限で静かに切り捨てられて同期対象が漏れないよう、
  // .order('id').range() で 1000 件ずつ全件ページング取得する。
  const PAGE_SIZE = 1000;
  const students: { id: string; last_name: string; first_name: string }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page } = await db
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
    return {
      synced: 0,
      skipped: 0,
      notFound: [],
      periodLabel: label,
      reason: '在籍中の生徒が見つかりませんでした',
    };
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
    return {
      synced,
      skipped,
      notFound,
      periodLabel: label,
      reason: 'カレンダーの面談予約から在籍生徒を特定できませんでした',
    };
  }

  const studentIdList = Array.from(matchedStudentIds);
  const itemIds = itemList.map((it) => it.id);

  // 2. 既存進捗を一括取得（生徒×項目ごとの select を1クエリにまとめる）
  const { data: existingRows } = await db
    .from('course_prep_student_progress')
    .select('student_id, item_id, status')
    .in('student_id', studentIdList)
    .in('item_id', itemIds);

  const statusMap = new Map<string, string>();
  for (const row of (existingRows || []) as Array<{
    student_id: string;
    item_id: string;
    status: string;
  }>) {
    statusMap.set(`${row.student_id}|${row.item_id}`, row.status);
  }

  // 3. 未完了の (生徒, 項目) のみ完了にするペイロードを構築
  const payload: Array<{ school_id: string; student_id: string; item_id: string; status: string }> =
    [];
  for (const studentId of studentIdList) {
    for (const item of itemList) {
      if (statusMap.get(`${studentId}|${item.id}`) === 'completed') {
        skipped++;
        continue;
      }
      payload.push({
        school_id: schoolId,
        student_id: studentId,
        item_id: item.id,
        status: 'completed',
      });
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

  return { synced, skipped, notFound, periodLabel: label };
}
