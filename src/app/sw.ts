import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, NetworkFirst, CacheFirst, StaleWhileRevalidate } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      // 静的アセット: Cache First
      matcher: /\.(?:js|css|woff2?)$/,
      handler: new CacheFirst({
        cacheName: "static-assets",
      }),
    },
    {
      // 画像: Stale While Revalidate
      matcher: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
      handler: new StaleWhileRevalidate({
        cacheName: "images",
      }),
    },
    {
      // Supabase API: Network First（認証・リアルタイムデータはキャッシュしない）
      matcher: /supabase\.co/,
      handler: new NetworkFirst({
        cacheName: "supabase-api",
        networkTimeoutSeconds: 10,
      }),
    },
    {
      // ページナビゲーション: Network First + オフラインフォールバック
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "pages",
        networkTimeoutSeconds: 5,
      }),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.mode === "navigate";
        },
      },
    ],
  },
});

serwist.addEventListeners();
