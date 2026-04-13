import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * 統合テスト用 Vitest 設定
 * ローカル Supabase (supabase start) に接続して実際の DB 操作をテストする。
 *
 * 実行: npm run test:integration
 * 前提: supabase start 済み、.env.test に接続情報が設定されていること
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/integration/**/*.test.ts'],
    setupFiles: ['./src/__tests__/integration/setup.ts'],
    // 統合テストはDB操作があるため直列実行
    sequence: { concurrent: false },
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
