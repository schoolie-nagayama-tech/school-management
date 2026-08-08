import bundleAnalyzer from '@next/bundle-analyzer';
import withSerwistInit from '@serwist/next';
import { withSentryConfig } from '@sentry/nextjs';

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
});

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
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
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
export default withSentryConfig(withBundleAnalyzer(withSerwist(nextConfig)), {
  silent: true,
  disableLogger: true,
  sourcemaps: {
    disable: true,
  },
  // Sentry 送信先への広告ブロッカーによる遮断を避けるため、自アプリ経由でプロキシする
  tunnelRoute: '/monitoring',
});
