import bundleAnalyzer from '@next/bundle-analyzer';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  experimental: {
    optimizePackageImports: ['lucide-react'],
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
  webpack: (config, { isServer }) => {
    config.ignoreWarnings = [
      { module: /node_modules/ },
      { message: /Failed to parse source map/ },
    ];
    
    // エラーハンドリングを緩和
    if (!isServer) {
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

export default withBundleAnalyzer(nextConfig);
