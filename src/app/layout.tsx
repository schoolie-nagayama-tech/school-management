import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from '@/contexts/AuthContext';
import { MasterDataProvider } from '@/contexts/MasterDataContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';

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
    <html lang="ja">
      <body className="antialiased">
        <ErrorBoundary>
          <AuthProvider>
            <MasterDataProvider>
              {children}
            </MasterDataProvider>
          </AuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
