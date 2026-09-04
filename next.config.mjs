import bundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';

// ★ PWA一時閉鎖中（2026-08-20・ユーザー判断）。
//   serwist によるサービスワーカー生成を止めている。/public/sw.js は生成物ではなく
//   手書きの自己解除SWに差し替え済み（既にインストール済み端末の登録を回収するため。
//   配信をやめるだけだと古いSWが残り、古いJSを配り続ける）。
//   再開するときは以下を戻す:
//     1. import withSerwistInit from '@serwist/next';
//     2. const withSerwist = withSerwistInit({ swSrc: 'src/app/sw.ts',
//          swDest: 'public/sw.js', disable: process.env.NODE_ENV === 'development' });
//     3. 最終行の export を withSerwist(nextConfig) で包む
//     4. public/sw.js を削除し、.gitignore の /public/sw.js を有効化
//     5. layout.tsx の manifest と ServiceWorkerUpdateBar を戻す

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverComponentsExternalPackages: ['web-push'],
    // Next 14.2 では instrumentation.ts の自動読み込みにこのフラグが必須
    // （Next 15 で標準化されるまでの暫定要件。Sentry のサーバー/エッジ初期化に使用）
    instrumentationHook: true,
  },

  // ESLintエラーでビルドを失敗させる（品質ゲート）
  eslint: {
    ignoreDuringBuilds: false,
  },

  // 型チェックは CI に一本化し、next build 中では走らせない。
  //
  // ★品質ゲートを外しているわけではない。
  //   .github/workflows/ci.yml に独立した `npx tsc --noEmit` ステップがあり、main への
  //   PR は型エラーがあれば必ず落ちる。これまでは CI で tsc を1回、その直後の
  //   `next build` でもう1回と、同じ型チェックを二重に走らせていた。
  //
  // ★なぜ外すか:
  //   Vercel のビルドコンテナは2コア8GBで、この二重チェックがメモリ・時間を圧迫し、
  //   ビルドがハングして45分でタイムアウトする事象が繰り返し起きていた
  //   （2026-09-01 の可観測性PRでも、GitHub Actions の `next build` は6分で成功する一方
  //     Vercel 側だけが失敗した）。ローカル/CI と Vercel で結果が変わる不安定さを取り除く。
  //
  // ★戻すとき: CI の tsc ステップを消す場合は、必ずここも false に戻すこと。
  //   どちらか片方だけになると型エラーが素通りする。
  typescript: {
    ignoreBuildErrors: true,
  },
  // 画像最適化の設定
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
  // セキュリティヘッダー（2026-08-08 セキュリティレビューで追加）。
  // - X-Frame-Options SAMEORIGIN: 外部サイトの iframe に本アプリのページを載せる
  //   クリックジャッキング（保護者ポータルの同意ボタン等を透明レイヤーで騙す攻撃）を防ぐ。
  //   DENY にしないのは自サイト内での将来のプレビュー用途を塞がないため。
  //   ※ /api/embed はトークン付き JSON API であり、ページの iframe 埋め込みは
  //     存在しないことを確認済み（このヘッダーで壊れる機能はない）。
  // - nosniff: Content-Type を無視した推測実行（アップロード画像をスクリプト扱い等）を防ぐ。
  // - Referrer-Policy: 外部リンクへ遷移したときにURLのパス（生徒IDや招待トークンを含み得る）を
  //   リファラとして漏らさない。
  // - Content-Security-Policy: XSSの多層防御（万一サニタイズを抜けても実行させない保険）。
  //   ★ script-src / default-src はあえて絞らない: Next.js の水和はインラインスクリプトを
  //     使うため、これらを厳格化すると nonce 配布の作り込みが要り、事故りやすい。
  //     代わりに nonce 不要で壊す心配がなく効果の大きい4本だけを敷く:
  //       object-src 'none'      … Flash等プラグイン由来のスクリプト実行を封じる
  //       base-uri 'self'        … <base>注入で相対URLを攻撃者ドメインに乗っ取る手口を封じる
  //       frame-ancestors 'self' … クリックジャッキング（XFOを無視するブラウザも含めて）
  //       form-action 'self'     … フォーム送信先を外部に差し替える手口を封じる
  async headers() {
    const csp = [
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "form-action 'self'",
    ].join('; ');
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },

  webpack: (config, { isServer }) => {
    config.ignoreWarnings = [{ module: /node_modules/ }, { message: /Failed to parse source map/ }];

    if (isServer) {
      config.externals.push('web-push');
    } else {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }

    return config;
  },
};

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

// Sentry: org/project/authToken を SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN で
// 設定するまではソースマップアップロードを無効化しておく（未設定でビルドを壊さないため）。
// 3つを Vercel の環境変数に設定したら sourcemaps.disable を外せば元コードのスタック
// トレースが見えるようになる。
export default withSentryConfig(withBundleAnalyzer(nextConfig), {
  silent: true,
  disableLogger: true,
  sourcemaps: {
    disable: true,
  },
  // Sentry 送信先への広告ブロッカーによる遮断を避けるため、自アプリ経由でプロキシする
  tunnelRoute: '/monitoring',
});
