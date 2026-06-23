/**
 * notification-server.ts
 *
 * 通知フィードの初期データをサーバー側で事前取得する（Phase3: SSRストリーミングの土台）。
 * このファイルはサーバー専用（'server-only' 宣言）。クライアントバンドルに含まれない。
 *
 * 狙い: 生徒管理ページ上部は全ボードがハイドレーション後に一斉 fetch するため、
 * 通知フィードが表示されるまでに「JSロード→hydrate→fetch」の待ちが入る。
 * サーバーで先にデータを取得して initialData として渡すことで、この待ちを無くす。
 *
 * セキュリティ: RLS 認証済みのサーバークライアント（createSupabaseServerClient）を使うため、
 * DB アクセスは常にログインユーザーの権限にスコープされる。対象教室も cookie を
 * 信頼の根拠にせず、RLS で返る schools からユーザーのアクセス可能範囲を導出する。
 *
 * 失敗・未ログイン・選択未解決のときは null を返し、クライアント側の従来取得に
 * フォールバックする（この事前取得はあくまで最適化で、壊れてもページは従来通り動く）。
 */
import 'server-only';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { loadNotificationFeed } from './notifications';
import type { NotificationInitialData } from './notifications';
import type { School } from '@/types/database';
import { isDynamicServerError } from '@/lib/utils/dynamicServerError';

// 型を再 export しておく（page.tsx 側での import を楽にする）
export type { NotificationInitialData };

/**
 * 通知フィードの初期データをサーバー側で事前取得する。
 *
 * bulletin-server.ts の prefetchBulletinInitial と同じパターンで実装。
 * 戻り値の { feedItems } を NotificationFeed の initialData プロップに渡す。
 */
export async function prefetchNotificationInitial(): Promise<NotificationInitialData | null> {
  try {
    // RLS 認証済みのサーバークライアントを生成
    const client = await createSupabaseServerClient();

    // 未ログインなら事前取得不可
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return null;

    // 通知フィードは講師(teacher)には表示しない（生徒管理ページの非講師ブランチでのみ描画）。
    // 講師の場合はサーバーでの無駄な取得を避けるため早期 return（クライアントでも描画されない）。
    const { data: profile } = await client
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile || profile.role === 'teacher') return null;

    // ユーザーがアクセス可能な学校（RLSでスコープ済み）。'all' の対象導出とデモ除外に使う。
    const { data: schoolRows } = await client.from('schools').select('*');
    const schools = (schoolRows || []) as School[];
    if (schools.length === 0) return null;

    // 現在の教室選択は cookie（AuthContext がミラー）から読む
    const cookieStore = await cookies();
    const selected = cookieStore.get('selectedSchoolId')?.value ?? null;
    if (!selected) return null;

    // 対象 schoolId の解決（AuthContext.getSelectedSchoolIds と同じ規則）:
    //   'all' → アクセス可能なうちデモを除いた全校 / 単一 → アクセス可能ならその1校
    let targetIds: string[];
    if (selected === 'all') {
      targetIds = schools.filter((s) => !s.is_demo).map((s) => s.id);
    } else if (schools.some((s) => s.id === selected)) {
      targetIds = [selected];
    } else {
      // 選択校にアクセス権が無い（cookie が陳腐化）→ クライアント側に委ねる
      return null;
    }
    if (targetIds.length === 0) return null;

    // 共有取得関数に RLS 認証済みクライアントを渡して実行
    const feedItems = await loadNotificationFeed(targetIds, client);

    return { feedItems };
  } catch (e) {
    // DynamicServerError（ビルドの静的生成プローブが cookies() で投げる）は再 throw して Next に委ねる。
    if (isDynamicServerError(e)) throw e;
    // 事前取得は最適化。失敗してもページは従来のクライアント取得で動くので握りつぶす。
    console.warn(
      '[prefetchNotificationInitial] 事前取得に失敗。クライアント取得にフォールバックします:',
      e
    );
    return null;
  }
}
