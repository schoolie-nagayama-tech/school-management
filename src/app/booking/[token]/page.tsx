/**
 * 公開面談予約ページ。
 * ログイン不要。トークンを props でクライアントコンポーネントに渡す。
 * URL: /booking/[token]
 */

import BookingClient from './BookingClient';

interface BookingPageProps {
  params: Promise<{ token: string }>;
}

export default async function BookingPage({ params }: BookingPageProps) {
  const { token } = await params;
  return <BookingClient token={token} />;
}
