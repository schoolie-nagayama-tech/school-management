# ローカルSupabase開発環境ガイド

## 概要

本番Supabase Cloud（`school-db`）と別に、Dockerでローカルに完全なSupabaseスタックを起動できます。統合テスト・開発・マイグレーション検証に使用します。

## 構成

```
supabase/
├── migrations/
│   ├── 00000000000000_base_schema.sql   ← 本番dumpから生成（ローカル初期化用）
│   ├── _archived_for_local_dev/         ← 日付付きmigration（本番push時のみ使用）
│   │   ├── 20260221_portal_menu_cascade_on_school_delete.sql
│   │   └── ...（37ファイル）
│   └── xxx_*.sql                         ← レガシー（CLIが自動スキップ）
├── config.toml
└── LOCAL_DEV.md (このファイル)
```

## セットアップ（初回のみ）

### 前提
- Docker Desktop インストール済み・起動中
- Supabase CLI インストール済み（`supabase --version`）

### 手順
```bash
# 1. ローカルSupabase起動（初回はDockerイメージDLで10〜20分）
npm run db:start

# 2. 接続情報を確認
npm run db:status

# 3. .env.test に自動で書き込まれている接続情報を確認
cat .env.test
```

## 日常運用

### 起動・停止
```bash
npm run db:start   # 起動
npm run db:stop    # 停止
npm run db:reset   # DBリセット（base_schema.sql を再適用）
npm run db:status  # 起動状況・接続情報表示
```

### 接続先
| サービス | URL |
|---------|-----|
| Studio (管理UI) | http://127.0.0.1:54323 |
| REST API | http://127.0.0.1:54321 |
| PostgreSQL | postgresql://postgres:postgres@127.0.0.1:54322/postgres |
| Mailpit (メール確認) | http://127.0.0.1:54324 |

## base_schema.sql の再生成

本番スキーマに変更があった時、ローカル用ベーススキーマを更新：

```bash
npm run db:dump
npm run db:reset
```

## 本番 push 時の注意 ⚠️

**ローカル開発では `_archived_for_local_dev/` に日付付きmigrationが退避されています。**
本番に `supabase db push` する前に、対象ファイルを `migrations/` ディレクトリに戻す必要があります：

```bash
# 1. 特定のmigrationを本番に反映する場合
mv supabase/migrations/_archived_for_local_dev/20260407_xxx.sql supabase/migrations/

# 2. 本番にpush
supabase db push

# 3. push完了後、再度退避
mv supabase/migrations/20260407_xxx.sql supabase/migrations/_archived_for_local_dev/
```

または、新規migrationを作る時は `supabase/migrations/` に直接作成 → push → 退避、でOK。

## なぜこの構成にしているか

- **本番dumpをbase_schemaに使う理由**: リポジトリの `xxx_*.sql`（34ファイル）と `schema.sql` では本番スキーマを完全に再現できない（一部テーブルが手動SQL作成でコミットされていない）。
- **日付付きmigrationを退避する理由**: 本番dumpに全て適用済みのため、ローカルで再実行すると `ALTER COLUMN IF NOT EXISTS` のない非冪等なSQLが衝突する。
  - 退避を怠ると実害が出る（2026-07-15 に実際に踏んだ）: 古い `xxx_student_interviews.sql` を再適用すると
    当時の `Enable all access for all users`（＝**匿名を含む全許可**）ポリシーが復活し、**適用済みのRLSロックダウンが巻き戻る**。
    ローカルがドリフトしていると、それを本番だと誤認したテストが書かれる（実際に
    「authenticated は掲示板を全部読める」という**本番と異なる前提のテスト**が混入していた）。

## 既知の制約・罠（2026-07-15 追記）

### 1. `npm run db:reset` は「同じ日付の migration が2本以上」あると失敗する ★未解決
Supabase CLI はファイル名の先頭からバージョンを取る。本リポジトリの命名は `YYYYMMDD_name.sql`（8桁）
のため、同じ日に2本作ると**両方ともバージョン `20260706` になり主キー衝突**する:
```
ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
Key (version)=(20260706) already exists.
```
- 回避: 退避を徹底して `migrations/` に同日複数を残さない。
- 恒久対策（未実施・要判断）: 新規 migration は**14桁フルタイムスタンプ**（`20260714000000_name.sql`）で作る。
  既存の8桁ファイルのリネームは `supabase db push` の適用済み判定に影響するため、本番の
  migration 履歴を確認してから行うこと。
- **ポータルv2の4本は14桁で作成済み**（衝突しない）。

### 2. `xxx_*` / `zzz_*` は CLI が黙ってスキップする
ファイル名が `<timestamp>_name.sql` に合わないため（63本）。`Skipping migration ...` と出るだけで失敗しない。
上記の「巻き戻し」の理由から、**スキップされるのが正しい**（base_schema に結果が入っている）。

### 3. `npm run db:dump` の前に**リンク先を必ず確認**する ★重要
`supabase projects list` で `linked: true` が **school-db-tokyo (bniistrbylypnwpfqszb)** になっているか見ること。
2026-07-15 時点で、旧シンガポールDB（`school-db` / mzxysqkuuxcfffwlfsvj）にリンクされた端末が存在した。
そのまま dump すると**旧DBから base_schema を作ってしまう**。
```bash
npx supabase link --project-ref bniistrbylypnwpfqszb
```
また `supabase db dump --linked` は**本番に一時ログインロールを作る**（純粋な読み取りではない）。
2026-07-15 現在、本番では `cli_login_postgres` のロール衝突で失敗する状態:
```
Failed to create login role: role "postgres" is a member of role "cli_login_postgres"
```
→ base_schema の再生成は**この解消が前提**（未解決）。

### 4. `db reset` 後に auth が 502 になることがある
コンテナ再起動で Kong が auth へのルートを見失う。統合テストが「テストユーザーの作成に失敗」で落ちたら:
```bash
docker restart supabase_kong_student-management
```

## トラブルシューティング

### `supabase start` が失敗する
- Docker Desktopが起動しているか確認
- `docker ps` でDocker接続を確認
- `supabase stop --no-backup` で一度完全停止してからやり直す

### テストがDBに接続できない
- `.env.test` の内容が `npm run db:status` の出力と一致しているか確認
- `supabase_publishable_key` / `secret_key` は `supabase start` 時に表示される
