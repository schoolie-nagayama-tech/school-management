import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getPortalContext } from '@/lib/mypage/supabase';
import { FormsHub } from '@/components/mypage/FormsHub';

export const dynamic = 'force-dynamic';

/**
 * 申し込み・手続きハブ（§7-3）。
 *
 * データは FormsHub が /api/mypage/forms から取得する（プッシュ判定は service role が要るため）。
 * ここはセッション確認と器だけ。
 */
export default async function MyPageFormsPage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect('/mypage/login');

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
        <h1 className="text-lg font-bold text-text-heading">申し込み・手続き</h1>
      </div>

      <FormsHub />
    </div>
  );
}
