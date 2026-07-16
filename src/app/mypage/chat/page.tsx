import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getPortalContext } from '@/lib/mypage/supabase';
import { ChatView } from '@/components/mypage/ChatView';

export const dynamic = 'force-dynamic';

/**
 * 保護者チャット画面（/mypage/chat）。ログイン必須。
 * 会話・テンプレ送信はクライアント（ChatView）が API 経由で行う。
 */
export default async function MyPageChatPage() {
  const ctx = await getPortalContext();
  if (!ctx) redirect('/mypage/login');

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
      <h1 className="mb-4 text-lg font-bold text-text-heading">教室との連絡</h1>
      <ChatView />
    </div>
  );
}
