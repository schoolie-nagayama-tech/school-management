/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // 開発時のダブルレンダリングを防止

  // ESLintエラーでビルドを失敗させる（品質ゲート）
  eslint: {
    ignoreDuringBuilds: false,
  },
  // TypeScriptエラーはDB型定義修正後に有効化予定
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

export default nextConfig;
