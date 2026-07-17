import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getPortalContext } from '@/lib/mypage/supabase';
import { getPortalAnnouncements } from '@/lib/mypage/announcements';
import { AnnouncementsView } from '@/components/mypage/AnnouncementsView';

export const dynamic = 'force-dynamic';

/**
 * 保護者お知らせ画面（/mypage/announcements）。ログイン必須。
 * RLS 越しに「自分に配信された投稿のみ」を取得して渡す（audience/target 判定は DB 側）。
 */
export default async function MyPageAnnouncementsPage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect('/mypage/login');

  const items = await getPortalAnnouncements(ctx.client, ctx.claims.sub);

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/mypage"
          className="inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-heading"
        >
          <ChevronLeft className="h-4 w-4" />
          マイページに戻る
        </Link>
      </div>
      <h1 className="mb-4 text-lg font-bold text-text-heading">お知らせ</h1>
      <AnnouncementsView initial={items} />
    </div>
  );
}
