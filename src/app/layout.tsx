import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "生徒管理システム",
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
        {children}
      </body>
    </html>
  );
}
