# ユーザー・教室データの保存場所

## DB の場所

- **Supabase プロジェクト**（`.env.local` の `NEXT_PUBLIC_SUPABASE_URL` で指定）
- **スキーマ:** `public`
- **テーブル:**
  - **`user_profiles`** … ユーザー情報（id, email, display_name, role, is_active, default_school_id など）
  - **`user_schools`** … ユーザーと教室の紐付け（user_id, school_id）
  - **`schools`** … 教室マスタ（id, name, code など）

## ユーザー編集の保存フロー（変更後）

- **ユーザー管理の「編集」で保存** → **PATCH /api/admin/users/[userId]** を呼ぶ
- API は **サービスロール** で以下を実行:
  1. `user_profiles` を更新（display_name, role, default_school_id）
  2. `user_schools` を同期（school_ids に合わせて追加・削除）
- ブラウザから直接 `user_profiles` / `user_schools` には書き込まないため、**RLS の影響を受けず**確実に保存・読み取りされます。

## 読み取り

- **ユーザー一覧:** GET /api/admin/users（サービスロールで `user_profiles` + `user_schools` を取得）
- **1件取得:** GET /api/admin/users/[userId]（同様にサービスロール）

## default_school_id について

- `user_profiles.default_school_id` はマイグレーション `xxx_user_profiles_default_school_id.sql` で追加
- 未実行の場合は Supabase の SQL Editor で実行するか、`supabase db push` で適用してください
