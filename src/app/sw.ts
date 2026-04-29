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

// プッシュ通知・通知クリックは ServiceWorkerGlobalScope のイベント
// serwist v9 は WorkerGlobalScope として型付けされているため最小 interface でキャストする
// プッシュ通知受信
// ServiceWorkerGlobalScope の型は tsconfig の lib に含まれないため any でキャスト
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).addEventListener("push", (event: { data?: { json(): unknown }; waitUntil(p: Promise<unknown>): void }) => {
  const data = (event.data?.json() ?? {}) as { title?: string; body?: string; url?: string };
  const title = data.title ?? "NEST";
  const options = {
    body: data.body ?? "新しい通知があります",
    icon: "/icons/icon-192.svg",
    badge: "/icons/icon-192.svg",
    data: { url: data.url ?? "/responses" },
    tag: "nest-push",
    renotify: true,
  } as NotificationOptions;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event.waitUntil((self as any).registration.showNotification(title, options));
});

// 通知クリック → 対象ページをフォーカス or 開く
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).addEventListener("notificationclick", (event: {
  notification: { close(): void; data?: { url?: string } };
  waitUntil(p: Promise<unknown>): void;
}) => {
  event.notification.close();
  const url: string = event.notification.data?.url ?? "/responses";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clients = (self as any).clients as {
    matchAll(opts?: object): Promise<Array<{ url: string; focus(): Promise<unknown> }>>;
    openWindow(url: string): Promise<unknown>;
  };
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
