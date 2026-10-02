import { Noto_Sans_JP } from 'next/font/google';

/**
 * 本文の日本語フォント（Google Fonts の Noto Sans JP）。
 *
 * ★layout.tsx に直書きせずこのファイルに切り出しているのは、CI のビルドでだけ
 *   notoSansJP.ci.ts に差し替えるため（next.config.mjs の NEST_SKIP_GOOGLE_FONTS）。
 *   next/font/google はビルドのたびに Google からフォントを取りに行き、GitHub Actions では
 *   その取得がときどき失敗して Build が落ちていた（2026-10-02 に2回。流し直すと通る）。
 *   CI のビルドが確かめたいのはコードが組めることで、フォントの中身ではない。
 * ★本番（Vercel）のビルドは差し替えない。このファイルがそのまま使われる。
 */
export const notoSansJP = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-sans-jp',
  preload: true,
});
