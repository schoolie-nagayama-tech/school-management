# 監視・アラート運用ガイド

## Sentry（エラー監視）

### 前提: DSN を設定しないと1件も届かない

Sentry の SDK は **DSN が未設定だと黙って無効化される**。ビルドもデプロイも成功するため、
「配線したつもりで実は何も届いていない」状態に気づけない。まず以下を確認すること。

| 環境変数                 | 用途                                       | 設定先            |
| ------------------------ | ------------------------------------------ | ----------------- |
| `SENTRY_DSN`             | サーバー側（API ルート・Server Component） | Vercel の環境変数 |
| `NEXT_PUBLIC_SENTRY_DSN` | ブラウザ側                                 | Vercel の環境変数 |

本番で `SENTRY_DSN` が未設定の場合、起動時に `SENTRY_DSN_MISSING` を Vercel のログに1度出す
（`src/instrumentation.ts`）。**Vercel の Logs でこれが出ていたら、まだ監視は動いていない。**

### 何が Sentry に届くか

- **API ルートで捕捉した例外**: `captureApiError()`（`src/lib/api-error.ts`）経由。
  `api_route` タグ（例: `POST /api/tasks`）と `api_action` タグで絞り込める。
- **画面のレンダリング例外**: `src/app/error.tsx`（管理・講師画面の全ページ）、
  `src/app/mypage/error.tsx`（保護者ポータル）、`src/app/portal/error.tsx`（公開フォーム）、
  `src/app/global-error.tsx`（ルートレイアウト自体のクラッシュ）。
- **捕捉されなかった例外**: `@sentry/nextjs` がルートハンドラを自動計装して拾う。

送らないもの: `redirect()` / `notFound()` の制御用エラー、fetch の `AbortError`、
ブラウザ拡張由来のノイズ（`src/lib/utils/sentryFilters.ts` と各 `Sentry.init` の `ignoreErrors`）。

### 個人情報の扱い

`sendDefaultPii: false` を明示しているので、SDK が自動収集する IP・Cookie は送られない。
ただし**こちらが context に詰めた値は素通りする**。`captureApiError` の context には
ID（uuid）・ロール・件数など、それ自体では個人を特定できないものだけを入れること。
氏名・メール・電話・住所・フォームの回答内容は入れない。

### 未設定の残作業

`next.config.mjs` で `sourcemaps: { disable: true }` になっているため、
**本番のスタックトレースは minify されたままで原因箇所を特定しづらい**。
`SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` を Vercel に設定したうえで
この行を外すと、元のコードで読めるようになる。

## ログの確認方法

### Vercel ダッシュボード

1. Vercel → プロジェクト → Logs タブ
2. フィルタ: `AUTH_FAILURE` で認証失敗を検索
3. フィルタ: `SCOPE_VIOLATION` でIDOR試行を検索
4. フィルタ: `OAUTH_STATE_MISMATCH` で OAuth の state 不一致（CSRF 試行かタイムアウト）を検索
5. フィルタ: `API_ERROR` で API ルートの例外を検索。JSON 1行で出るので `route` / `sentryEventId` で串刺しにできる
6. フィルタ: `SENTRY_DSN_MISSING` で監視が無効になっていないかを確認

### Supabase ダッシュボード

1. Supabase → Logs → Postgres Logs
2. RLSで弾かれたクエリが記録される
3. Supabase → Advisors で security / performance の lint を定期確認する
   （RLS 未設定のテーブル、匿名に開いた権限、未インデックスの外部キーなどが出る）

## 異常の兆候

- 短時間に同一IPから AUTH_FAILURE が多発 → 不正アクセス試行
- SCOPE_VIOLATION の頻発 → IDOR攻撃
- OAUTH_STATE_MISMATCH の頻発 → OAuth のCSRF試行（正常な往復では起きない）
- 500エラー / API_ERROR の急増 → システム障害
- cron が「成功」なのに処理件数が常に0 → DB取得の失敗を握り潰している可能性

## 対応

- 緊急時: Supabase Dashboard → Authentication → Ban User
- API Key 漏洩疑い: Supabase Dashboard → Settings → API → Rotate Keys
- 監査証跡: `admin_audit_logs` テーブル。記録される操作は
  `user.create` / `user.update` / `user.delete` / `user.impersonate`（なりすましログイン）。
  なりすましは `action = 'user.impersonate'` で絞ると「誰がいつ誰になりすましたか」を追える
  （`actor_id` が実行した管理者、`target_id` がなりすまし先、`ip_address` も記録）。
