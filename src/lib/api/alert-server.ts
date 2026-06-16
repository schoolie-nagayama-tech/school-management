import 'server-only';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getAlertsLight } from './alerts';
import type { StudentAlerts } from '@/types/alerts';
import type { School } from '@/types/database';

/**
 * AlertBoard に渡す SSR 初期データの形（AlertBoard.initialData プロップと一致させること）。
 * 軽量アラート（Light: interview_overdue / application_overdue / interview_task /
 * schedule_change_unapplied）のみを事前取得する。
 * Heavy アラート（成績・テスト系）は引き続きクライアントで遅延取得される。
 */
export interface AlertInitialData {
  studentAlerts: StudentAlerts[];
}

/**
 * アラートボードの初期データをサーバー側で事前取得する（Phase3: SSRストリーミングの土台）。
 *
 * 狙い: 生徒管理ページ上部は全ボードがハイドレーション後に一斉 fetch するため、
 * クリティカルな Light アラートが出るまでに「JSロード→hydrate→fetch」の待ちが入る。
 * Light アラートの初期データをサーバーで先に取得して initialData として渡すことで、
 * この待ちを無くす。Heavy アラートは引き続きクライアントで whenNetworkIdle() 後に取得する。
 *
 * セキュリティ: RLS 認証済みのサーバークライアント（createSupabaseServerClient）を使うため、
 * DB アクセスは常にログインユーザーの権限にスコープされる。'all' の対象校もユーザーが
 * 実際にアクセスできる学校（RLSで返る schools）から導出し、cookie 値を信頼の根拠にしない。
 * getAlertsLight には client を明示渡しすることで、モジュールレベルの in-memory キャッシュ
 * への読み書きをスキップさせ、ユーザー間でデータが混在しないようにする。
 *
 * 失敗・未ログイン・選択未解決のときは null を返し、クライアント側の従来取得にフォールバックする
 * （＝この事前取得はあくまで最適化で、壊れてもページは従来通り動く）。
 */
export async function prefetchAlertInitial(): Promise<AlertInitialData | null> {
  try {
    const client = await createSupabaseServerClient();

    // 未ログインはサーバー取得不可
    const { data: { user } } = await client.auth.getUser();
    if (!user) return null;

    // ユーザーがアクセス可能な学校（RLSでスコープ済み）。
    // 'all' の対象導出・デモ除外・アクセス権検証に使う。
    const { data: schoolRows } = await client.from('schools').select('*');
    const schools = (schoolRows || []) as School[];
    if (schools.length === 0) return null;

    // 現在の教室選択は cookie（AuthContext がミラー）から読む。
    // cookie の値そのものをアクセス権の根拠にはせず、RLS で返る schools と照合する。
    const cookieStore = await cookies();
    const selected = cookieStore.get('selectedSchoolId')?.value ?? null;
    if (!selected) return null;

    // 対象 schoolId の解決（bulletin-server と同じ規則に合わせる）:
    //   'all' → アクセス可能なうちデモを除いた全校
    //   単一 → アクセス可能な学校に含まれる場合のみその1校
    //   不一致（cookie 陳腐化）→ クライアント側に委ねる
    let targetIds: string[];
    if (selected === 'all') {
      targetIds = schools.filter((s) => !s.is_demo).map((s) => s.id);
    } else if (schools.some((s) => s.id === selected)) {
      targetIds = [selected];
    } else {
      return null;
    }
    if (targetIds.length === 0) return null;

    // getAlertsLight に RLS 認証済みクライアントを渡す。
    // これにより in-memory キャッシュをスキップし、ユーザー間のデータ混在を防ぐ。
    const studentAlerts = await getAlertsLight(targetIds, {}, client);

    return { studentAlerts };
  } catch (e) {
    // 事前取得は最適化。失敗してもページは従来のクライアント取得で動くので握りつぶす。
    console.warn('[prefetchAlertInitial] 事前取得に失敗。クライアント取得にフォールバックします:', e);
    return null;
  }
}
