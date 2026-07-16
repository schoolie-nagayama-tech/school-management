import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getPortalContext } from '@/lib/mypage/supabase';
import { ReportsView, type ReportStudent } from '@/components/mypage/ReportsView';

export const dynamic = 'force-dynamic';

/**
 * 授業報告書の一覧ページ（§7-4・UIモック セクション1）。
 *
 * ★ 兄弟リストはここ（サーバー）で RLS 越しに解決する（予定ページと同じ作法）:
 *   students の portal ポリシー（紐づけ＋在籍中）が効くので、退塾超過の生徒は
 *   そもそもタブに出ない。報告書本体は ReportsView から API 経由で取得する。
 */
export default async function ReportsPage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect('/mypage/login');

  const { client } = ctx;

  const { data: rows } = await client
    .from('students')
    .select('id, last_name, first_name, grade')
    .order('grade', { ascending: false });

  const students: ReportStudent[] = (
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
        <h1 className="text-lg font-bold text-text-heading">授業報告書</h1>
      </div>

      <ReportsView students={students} />
    </div>
  );
}
