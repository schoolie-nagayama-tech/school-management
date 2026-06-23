import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    // .claude/worktrees 配下には別ブランチの作業コピーが入ることがあり、
    // そのテストまで拾うと本体と二重実行・誤検知になるため除外する
    exclude: ['src/__tests__/integration/**', 'node_modules/**', '.claude/**'],
    setupFiles: ['./src/__tests__/setup.ts'],
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
