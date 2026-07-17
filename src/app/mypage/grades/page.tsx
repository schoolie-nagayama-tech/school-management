import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getPortalContext } from '@/lib/mypage/supabase';
import { GradesView, type GradesStudent } from '@/components/mypage/GradesView';

export const dynamic = 'force-dynamic';

/**
 * 成績（保護者の入力＋閲覧）ページ。
 *
 * 正典: docs/portal-v2-requirements.md §7-5「Stage 5 詳細仕様: 成績の保護者入力＋閲覧」。
 *
 * ★ 兄弟リストはここ（サーバー）で RLS 越しに解決する（schedule/reports ページと同じ作法）:
 *   students の portal ポリシー（紐づけ＋在籍中）が効くので、退塾超過の生徒は
 *   そもそもタブに出ない。成績本体（承認済み成績＋自分の申請）は GradesView から
 *   API 経由で取得する。
 *
 * ★ ダッシュボード・/mypage メニューへの導線はまだ足さない（サーバー担当のAPIと結合し、
 *   動作確認してから追加する。§実装指示）。このページに直接来れば動く。
 */
export default async function GradesPage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect('/mypage/login');

  const { client } = ctx;

  const { data: rows } = await client
    .from('students')
    .select('id, last_name, first_name, grade')
    .order('grade', { ascending: false });

  const students: GradesStudent[] = (
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
        <h1 className="text-lg font-bold text-text-heading">成績</h1>
      </div>

      <GradesView students={students} />
    </div>
  );
}
