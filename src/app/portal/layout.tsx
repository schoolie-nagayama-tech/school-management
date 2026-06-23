import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'お申し込みポータル',
  description: '各種お申し込みページ。お申し込み確認メールが届きます。',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#10b981',
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
