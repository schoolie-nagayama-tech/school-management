import type { Metadata } from "next";
import localFont from "next/font/local";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";
import { AuthProvider } from '@/contexts/AuthContext';
import { MasterDataProvider } from '@/contexts/MasterDataContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ImpersonationBanner } from '@/components/ImpersonationBanner';
import { SpeedInsights } from "@vercel/speed-insights/next";

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-sans-jp",
  preload: true,
});

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  display: "swap",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  display: "swap",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "NEST",
  description: "学習塾向け生徒管理システム",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${notoSansJP.variable} ${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="antialiased">
        <ErrorBoundary>
          <AuthProvider>
            <MasterDataProvider>
              <ImpersonationBanner />
              {children}
              <SpeedInsights />
            </MasterDataProvider>
          </AuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
