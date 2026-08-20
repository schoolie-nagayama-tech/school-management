/*
 * 自己解除サービスワーカー（PWAの一時閉鎖・2026-08-20）
 *
 * ★ なぜ「空のSW」ではなく自己解除なのか:
 *   ブラウザは一度登録した SW を、配信をやめても勝手には捨てない。serwist を外して
 *   /sw.js を消すだけだと、既にインストール済みの端末では**古いSWが動き続け**、
 *   static-assets の StaleWhileRevalidate が古いJS/CSSを配り続ける。
 *   ＝「デプロイしたのに画面が変わらない」状態が個々の端末に残り続ける。
 *   同じパス(/sw.js)に、自分を unregister してキャッシュを全消しするSWを置くことで、
 *   既存の登録を確実に回収する。
 *
 * ★ これは恒久版ではない。PWAを再開するときはこのファイルを削除し、
 *   next.config.mjs の withSerwist と src/app/sw.ts を元に戻す（該当箇所にコメントあり）。
 *   その際、この自己解除SWを掴んだ端末は登録が消えているだけなので、
 *   再訪時に新しいSWが普通に登録される。
 */

// 待機せず即座に有効化する（解除は早いほどよい。旧SWと違い配信内容を持たないので
// 「古いJS + 新しいSW」の食い違いは起きない）。
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 1) 自分自身の登録を解除する
      await self.registration.unregister();

      // 2) 旧SWが作ったキャッシュを全部消す
      //    （static-assets / images / supabase-api / pages / precache）
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));

      // 3) 開いているタブを再読み込みして、ネットワークから最新を取り直させる
      //    これをしないと、解除した回のセッションだけ古いキャッシュのまま残る。
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })()
  );
});
