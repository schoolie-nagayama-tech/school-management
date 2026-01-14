/** @type {import('next').NextConfig} */
const nextConfig = {
  // 画像最適化の設定（Supabaseの画像を使用する場合）
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
