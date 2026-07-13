import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Noto_Sans_JP } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { resolveServerAuth } from '@/lib/auth/resolveServerAuth';
import { MasterDataProvider } from '@/contexts/MasterDataContext';
import { ThemeProvider, themeInitScript } from '@/contexts/ThemeContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ImpersonationBanner } from '@/components/ImpersonationBanner';
import { BulletinUnreadProvider } from '@/contexts/BulletinUnreadContext';
import { UnreadBulletinGate } from '@/components/bulletin/UnreadBulletinGate';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Toaster } from 'sonner';

const notoSansJP = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-sans-jp',
  preload: true,
});

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  display: 'swap',
  variable: '--font-geist-sans',
  weight: '100 900',
});

const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  display: 'swap',
  variable: '--font-geist-mono',
  weight: '100 900',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'NEST',
  description: '学習塾向け生徒管理システム',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'NEST',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // サーバーで認証を解決し AuthProvider にシードする（Phase3 Pillar A）。
  // 未ログイン/失敗時は null を返し、クライアント側の従来フローにフォールバックする。
  // （getUser の1往復が全リクエストに乗るが、認証済みページの初回描画が根本的に速くなる）
  const initialAuth = await resolveServerAuth();

  return (
    <html
      lang="ja"
      className={`${notoSansJP.variable} ${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <meta name="theme-color" content="#d32f2f" />
      </head>
      <body className="antialiased">
        <ErrorBoundary>
          <ThemeProvider>
            <AuthProvider initialAuth={initialAuth}>
              <MasterDataProvider>
                {/* 掲示板の未読状態を一元管理し、ヘッダーバッジと既読ゲートで共有する */}
                <BulletinUnreadProvider>
                  <ImpersonationBanner />
                  {children}
                  {/* 講師に未読の連絡があれば全画面で表示し既読を促す（未読0で自動的に閉じる） */}
                  <UnreadBulletinGate />
                  {/* アプリ全体のトースト通知（ボタン操作のフィードバック用） */}
                  <Toaster richColors position="top-center" />
                  <SpeedInsights />
                </BulletinUnreadProvider>
              </MasterDataProvider>
            </AuthProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
