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

## トラブルシューティング

### `supabase start` が失敗する
- Docker Desktopが起動しているか確認
- `docker ps` でDocker接続を確認
- `supabase stop --no-backup` で一度完全停止してからやり直す

### テストがDBに接続できない
- `.env.test` の内容が `npm run db:status` の出力と一致しているか確認
- `supabase_publishable_key` / `secret_key` は `supabase start` 時に表示される
