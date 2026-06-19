/**
 * Next.js の `DynamicServerError`（`cookies()`/`headers()` 等を使ったルートが
 * 静的プリレンダーできないときに投げられる内部エラー）を判定する。
 *
 * 用途: サーバー側の prefetch/認証解決ヘルパーは「失敗したらクライアント取得に
 * フォールバックする」ために広めの try/catch で包んでいる。しかしこの catch が
 * ビルド時の静的生成プローブで投げられる DynamicServerError まで握りつぶすと、
 *   (1) Next にとっては「このルートは動的」というシグナルなので、本来は伝播させて
 *       Next にルートを動的判定させるのが作法（握りつぶしは非推奨）、
 *   (2) ビルドログに大量の warn が出て本物のエラーを覆い隠す、
 * という2つの問題が起きる。そこで catch では「DynamicServerError なら再 throw、
 * それ以外の本物のエラーだけ握りつぶして null フォールバック」とするために使う。
 *
 * 判定は Next 内部の `isDynamicServerError`（next/dist の内部パス）に依存すると
 * バージョン間で壊れやすいため、公開契約に近い `digest === 'DYNAMIC_SERVER_USAGE'`
 * を直接見る（Next 自身のエラーバウンダリでも使われる安定した値）。
 */
const DYNAMIC_SERVER_USAGE_DIGEST = 'DYNAMIC_SERVER_USAGE';

export function isDynamicServerError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    (err as { digest?: unknown }).digest === DYNAMIC_SERVER_USAGE_DIGEST
  );
}
