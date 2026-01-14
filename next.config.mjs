/** @type {import('next').NextConfig} */
const nextConfig = {
  // ESLintエラーをビルド時にスキップ
  eslint: {
    ignoreDuringBuilds: true,
  },
  // TypeScriptエラーをビルド時にスキップ
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
};

export default nextConfig;
