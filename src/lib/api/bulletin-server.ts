import 'server-only';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getBulletinPostsBatch, getBulletinLabelsBatch } from './bulletin';
import type { BulletinPost, BulletinLabel } from '@/types/bulletin';
import type { School } from '@/types/database';
import { isDynamicServerError } from '@/lib/utils/dynamicServerError';

/**
 * BulletinBoard に渡す SSR 初期データの形（BulletinBoard.initialData と一致させること）。
 */
export interface BulletinInitialData {
  posts: BulletinPost[];
  labelsBySchool: Record<string, BulletinLabel[]>;
  schools: School[];
  unreadCount: number;
}

/**
 * 連絡掲示板の初期データをサーバー側で事前取得する（Phase3: SSRストリーミングの土台）。
 *
 * 狙い: 生徒管理ページ上部は全ボードがハイドレーション後に一斉 fetch するため、
 * クリティカルな内容が出るまでに「JSロード→hydrate→fetch」の待ちが入る。掲示板の初期
 * データをサーバーで先に取得して initialData として渡すことで、この待ちを無くす。
 *
 * セキュリティ: RLS 認証済みのサーバークライアント（createSupabaseServerClient）を使うため、
 * DB アクセスは常にログインユーザーの権限にスコープされる。'all' の対象校もユーザーが
 * 実際にアクセスできる学校（RLSで返る schools）から導出し、cookie 値を信頼の根拠にしない。
 *
 * 失敗・未ログイン・選択未解決のときは null を返し、クライアント側の従来取得にフォールバックする
 * （＝この事前取得はあくまで最適化で、壊れてもページは従来通り動く）。
 */
export async function prefetchBulletinInitial(): Promise<BulletinInitialData | null> {
  try {
    const client = await createSupabaseServerClient();

    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return null;

    // ロール（既読数の対象は講師のみ。BulletinBoard の canRead と揃える）
    const { data: profile } = await client
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile) return null;
    const canRead = profile.role === 'teacher';

    // ユーザーがアクセス可能な学校（RLSでスコープ済み）。'all' の対象導出とデモ除外に使う。
    const { data: schoolRows } = await client.from('schools').select('*');
    const schools = (schoolRows || []) as School[];
    if (schools.length === 0) return null;

    // 現在の教室選択は cookie（AuthContext がミラー）から読む。
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

    const userId = user.id;
    const [postsBySchool, labelsBySchool] = await Promise.all([
      getBulletinPostsBatch(targetIds, { includeArchived: false, userId }, client),
      getBulletinLabelsBatch(targetIds, client),
    ]);

    // BulletinBoard.fetchData と同じ後処理: school_name 付与・ピン優先で新しい順にソート。
    const nameById: Record<string, string> = {};
    for (const s of schools) nameById[s.id] = s.name;
    const selectedSchools = schools.filter((s) => targetIds.includes(s.id));

    const posts: BulletinPost[] = [];
    for (const sid of targetIds) {
      const name = nameById[sid] ?? null;
      for (const post of postsBySchool[sid] || []) {
        posts.push({ ...post, school_name: name });
      }
    }
    posts.sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // 未読数は取得済みの is_read から算出（講師のみ。BulletinBoard と同じ規則）
    const unreadCount = canRead ? posts.filter((p) => !p.is_read).length : 0;

    return { posts, labelsBySchool, schools: selectedSchools, unreadCount };
  } catch (e) {
    // DynamicServerError（ビルドの静的生成プローブが cookies() で投げる）は再 throw して Next に委ねる。
    if (isDynamicServerError(e)) throw e;
    // 事前取得は最適化。失敗してもページは従来のクライアント取得で動くので握りつぶす。
    console.warn(
      '[prefetchBulletinInitial] 事前取得に失敗。クライアント取得にフォールバックします:',
      e
    );
    return null;
  }
}
