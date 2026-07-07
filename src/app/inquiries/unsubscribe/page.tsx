/**
 * 公開ページ: 追客メールの配信停止。
 * ログイン不要。メール本文の「配信を停止する」リンクから遷移する。
 * URL: /inquiries/unsubscribe?token=...
 */

import UnsubscribeClient from './UnsubscribeClient';

export const dynamic = 'force-dynamic';

interface UnsubscribePageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
  const { token } = await searchParams;
  return <UnsubscribeClient token={token ?? ''} />;
}
