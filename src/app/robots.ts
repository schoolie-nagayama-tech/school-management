import type { MetadataRoute } from 'next';

/**
 * robots.txt: すべてのクローラーに全ページの巡回を断る（2026-09-30）。
 *
 * ★なぜ Disallow まで書くか:
 *   Google は「robots.txt で止めたページは noindex も読めない」ので、既に検索に載っているサイトでは
 *   Disallow せず noindex だけにするのが定石。NEST は 2026-09-30 時点で検索に載っていないことを
 *   確認したうえで、巡回そのものを断る（AI の学習用クローラーなど noindex を見ないものにも効く）。
 *   もし将来どこかで検索に載ってしまったら、この Disallow を一時的に外して noindex を読ませ、
 *   Search Console の削除ツールと併用すること。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
