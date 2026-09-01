# 運用 Runbook

## 1. 定期バックアップ

### Supabase のバックアップ

- Supabase Pro プラン: 自動で毎日バックアップ（7日間保持）
- Free プラン: 手動バックアップが必要

### 手動バックアップ手順

1. Supabase Dashboard → Settings → Database
2. 「Download backup」でダウンロード
3. または CLI: `supabase db dump -f backup_YYYYMMDD.sql`

### 推奨バックアップスケジュール

- 毎週月曜: フルバックアップ（`supabase db dump`）
- 重要な変更前: スナップショット

## 2. 障害対応

### 症状: 管理画面が表示されない

1. Vercel ダッシュボードでデプロイ状態を確認
2. Supabase ダッシュボードでDB接続状態を確認
3. 直近のデプロイが原因なら Vercel → Deployments → 前バージョンに Rollback

### 症状: ログインできない

1. Supabase Dashboard → Authentication → Users でユーザー状態を確認
2. 必要ならパスワードリセットリンクを発行
3. Auth サービス自体の障害: https://status.supabase.com を確認

### 症状: データが消えた

1. Supabase Dashboard → Database → Backups からリストア
2. Free プランの場合: 手動バックアップから `psql` でリストア
3. 重要: リストア前に現在のDBをバックアップ（二次被害防止）

### 症状: セキュリティインシデント（不正アクセス疑い）

1. Supabase Dashboard → Settings → API → API Keys を Rotate
2. Vercel → Environment Variables で新しいキーに更新
3. Vercel で再デプロイ
4. Supabase → Authentication で不審なユーザーを Ban
5. `admin_audit_logs` テーブルで操作履歴を確認

## 3. 環境変数一覧

| 変数名                        | 用途         | 更新が必要な場面   |
| ----------------------------- | ------------ | ------------------ |
| NEXT_PUBLIC_SUPABASE_URL      | Supabase URL | プロジェクト移行時 |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | 匿名キー     | キーRotate時       |
| SUPABASE_SERVICE_ROLE_KEY     | 管理キー     | キーRotate時       |

## 4. seed実行事故からの復旧

万が一本番で `seed.dev.sql` を実行してしまった場合:

1. **即座にSupabase Dashboardからバックアップをリストア**
2. バックアップがない場合: 復旧不可能（定期バックアップの重要性）
3. seed.dev.sql には100件ガードがあるため、通常は実行前にエラーで停止する
