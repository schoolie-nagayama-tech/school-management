import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getPortalContext } from '@/lib/mypage/supabase';
import { ScheduleView, type ScheduleStudent } from '@/components/mypage/ScheduleView';

export const dynamic = 'force-dynamic';

/**
 * 予定（時間割・今後の予定）ページ。
 *
 * 正典: docs/portal-v2-requirements.md §4「S. スケジュール」（Grow 置換の G4/G5）。
 *
 * ★ 兄弟リストはここ（サーバー）で RLS 越しに解決する:
 *   students の portal ポリシー（紐づけ＋在籍中）が効くので、退塾超過の生徒は
 *   そもそもタブに出ない。予定本体は ScheduleView から API 経由で取得する。
 */
export default async function SchedulePage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect('/mypage/login');

  const { client } = ctx;

  // 紐づけ生徒（RLS で在籍中の紐づけ生徒だけが返る）。
  const { data: rows } = await client
    .from('students')
    .select('id, last_name, first_name, grade')
    .order('grade', { ascending: false });

  const students: ScheduleStudent[] = (
    (rows ?? []) as unknown as Array<{
      id: string;
      last_name: string;
      first_name: string;
      grade: number | null;
    }>
  ).map((s) => ({
    id: s.id,
    name: `${s.last_name} ${s.first_name}`,
    grade: s.grade,
  }));

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Link
          href="/mypage"
          aria-label="マイページに戻る"
          className="text-text-muted transition-colors hover:text-text-heading"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-bold text-text-heading">予定</h1>
      </div>

      <ScheduleView students={students} />
    </div>
  );
}
