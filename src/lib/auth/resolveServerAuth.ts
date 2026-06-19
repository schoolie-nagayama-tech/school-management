import 'server-only';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getPermissions } from '@/types/database';
import type { UserProfile, Permission } from '@/types/database';
import { resolveSelectedSchoolId } from './selectedSchool';
import { isDynamicServerError } from '@/lib/utils/dynamicServerError';

/**
 * サーバーで先に解決した認証情報。AuthProvider の初期 state にそのまま採用される
 * （= AuthContext.fetchProfile が組み立てる state のサーバー版）。
 * Server Component → Client Component(AuthProvider) に props で渡すため、
 * すべて JSON シリアライズ可能な値であること。
 */
export interface InitialAuth {
  user: User;
  profile: UserProfile;
  permissions: Permission;
  schoolIds: string[];
  demoSchoolIds: string[];
  selectedSchoolId: string | 'all' | null;
}

/**
 * リクエストの Cookie からログインセッションを読み、AuthProvider の初期 state を
 * サーバー側で組み立てる（Phase3 Pillar A: 認証サーバーシード）。
 *
 * 狙い: 従来はブラウザで「セッション解決 → fetchProfile」を待ってから profile/権限/
 * 対象校が確定していた。その間ボードは profile=null で本来の描画ができず、確定後に
 * 再 fetch・再描画していた。これをサーバーで先に確定して AuthProvider に渡すことで、
 * 初回描画から profile が使え、認証待ちギャップと再 fetch を無くす（全ページに効く）。
 *
 * セキュリティ: RLS 認証済みのサーバークライアント（createSupabaseServerClient）で
 * DB を読むため、schools/user_schools は常にログインユーザーの権限にスコープされる。
 * cookie の selectedSchoolId は「保存済みのUI選択」としてのみ使い、対象校の導出は
 * 必ず RLS で返った実アクセス校から行う（cookie 値を信頼の根拠にしない）。
 *
 * 失敗・未ログイン・未登録のときは null を返し、クライアント側の従来フローに委ねる
 * （＝この事前解決はあくまで最適化で、壊れてもアプリは従来通り動く）。
 * 特に「ログインはできたが user_profiles 無し」のケースは、signOut + ログイン画面送り
 * というクライアント専用の副作用を伴うため、ここでは何もせず null を返してクライアントに任せる。
 */
export async function resolveServerAuth(): Promise<InitialAuth | null> {
  try {
    const client = await createSupabaseServerClient();

    const { data: { user } } = await client.auth.getUser();
    if (!user) return null;

    // プロファイル（role / default_school_id を含む全カラム）
    const { data: profileRow } = await client
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    // 未登録ユーザーはクライアントの signOut フローに委ねる（ここでは副作用を起こさない）
    if (!profileRow) return null;
    const profile = profileRow as UserProfile;
    const permissions = getPermissions(profile.role);

    // 対象校とデモ校（AuthContext.fetchProfile と同じ規則）
    let schoolIds: string[] = [];
    let demoSchoolIds: string[] = [];
    if (profile.role === 'admin' || profile.role === 'owner') {
      // admin/owner は全校アクセス可（RLS でも全校が返る）
      const { data: schools } = await client.from('schools').select('id, is_demo');
      const rows = (schools || []) as Array<{ id: string; is_demo: boolean | null }>;
      schoolIds = rows.map((s) => s.id);
      demoSchoolIds = rows.filter((s) => s.is_demo).map((s) => s.id);
    } else {
      // その他のロールは紐付けられた教室のみ（join した school.is_demo でデモ判定）
      const { data: us } = await client
        .from('user_schools')
        .select('school_id, school:schools(is_demo)')
        .eq('user_id', user.id);
      const rows = (us || []) as Array<{ school_id: string; school: { is_demo?: boolean } | null }>;
      schoolIds = rows.map((r) => r.school_id);
      demoSchoolIds = rows.filter((r) => r.school?.is_demo).map((r) => r.school_id);
    }

    // 教室選択は cookie（AuthContext がミラー）から。決定ロジックはクライアントと共有。
    const cookieStore = await cookies();
    const savedSchoolId = cookieStore.get('selectedSchoolId')?.value ?? null;
    const selectedSchoolId = resolveSelectedSchoolId(
      schoolIds,
      demoSchoolIds,
      savedSchoolId,
      profile.default_school_id ?? null,
    );

    return { user, profile, permissions, schoolIds, demoSchoolIds, selectedSchoolId };
  } catch (e) {
    // DynamicServerError（ビルドの静的生成プローブが cookies() で投げる）は握りつぶさず
    // 再 throw して Next にルートを動的判定させる（握りつぶすと作法に反し、ログも汚れる）。
    if (isDynamicServerError(e)) throw e;
    // 事前解決は最適化。失敗してもクライアント側の従来フローで認証されるので握りつぶす。
    console.warn('[resolveServerAuth] サーバー認証解決に失敗。クライアント解決にフォールバックします:', e);
    return null;
  }
}
