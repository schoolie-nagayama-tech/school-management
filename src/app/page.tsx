import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isTeacher } from '@/lib/utils/roles';

/**
 * ルート（/）の着地先。
 *
 * 講師は「本日の授業」、教室長以上は従来どおり「生徒管理」へ送る
 * （正典 docs/teacher-home-mode-plan.md §1-7）。
 * 家モードの講師にとって /students はゲートで止まる行き止まりなので、
 * 家/教室のどちらでも意味のある /today を講師の起点にする。
 *
 * ロール取得に失敗・未ログインのときは従来の /students へ倒す
 * （未ログインはこの後 AuthContext がログイン画面へ送るため挙動は変わらない）。
 */
export const dynamic = 'force-dynamic';

export default async function Home() {
  let role: string | null = null;

  // ★ redirect() は NEXT_REDIRECT を throw するので try の外で呼ぶ
  //   （中で呼ぶと catch に飲まれてリダイレクトが効かない）。
  try {
    const client = await createSupabaseServerClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (user) {
      const { data } = await client
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      role = ((data as { role?: string } | null)?.role as string) ?? null;
    }
  } catch {
    // 取得失敗は最適化の失敗にすぎない。従来どおり /students に倒す。
  }

  redirect(isTeacher(role) ? '/today' : '/students');
}
