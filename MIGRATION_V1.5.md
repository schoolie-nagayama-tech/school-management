# v1.5 移行手順

## 概要

v1.5では以下の機能が追加されました：
- 教室（schools）概念の導入
- 論理削除（soft delete）
- 作業ログ記録
- 並び順ルールの実装

## データベース移行手順

### 1. スキーマの更新

`supabase/schema.sql`をSupabaseのSQL Editorで実行してください。

**注意**: このSQLは既存データの移行処理を含んでいます：
- デフォルト教室（code='DEFAULT'）を自動作成
- 既存の`students`レコードに`school_id`を自動割り当て
- `student_code`のUNIQUE制約を`(school_id, student_code)`に変更

### 2. デフォルト教室IDの取得

SQL Editorで以下を実行：

```sql
SELECT id, name, code FROM schools WHERE code = 'DEFAULT';
```

表示された`id`（UUID）をコピーしてください。

### 3. 環境変数の設定

`.env.local`に以下を追加：

```
NEXT_PUBLIC_DEFAULT_SCHOOL_ID=上記で取得したUUID
```

### 4. 動作確認

1. アプリケーションを再起動
2. 生徒一覧が正しく表示されることを確認
3. 新規登録・編集・削除が正常に動作することを確認

## 既存データの確認

移行後、以下で確認できます：

```sql
-- デフォルト教室に割り当てられた生徒数
SELECT COUNT(*) FROM students 
WHERE school_id = (SELECT id FROM schools WHERE code = 'DEFAULT');

-- 削除されていない生徒数
SELECT COUNT(*) FROM students WHERE deleted_at IS NULL;

-- ログの確認
SELECT * FROM student_logs ORDER BY created_at DESC LIMIT 10;
```

## トラブルシューティング

### エラー: "NEXT_PUBLIC_DEFAULT_SCHOOL_ID が設定されていません"

`.env.local`に`NEXT_PUBLIC_DEFAULT_SCHOOL_ID`が設定されているか確認してください。

### エラー: "この生徒コードは既に使用されています"

`(school_id, student_code)`のUNIQUE制約により、同じ教室内で同じ生徒コードは使用できません。
別の教室では同じコードを使用できます。

### 既存データが表示されない

1. `school_id`が正しく設定されているか確認
2. `deleted_at`がNULLか確認
3. 環境変数の`NEXT_PUBLIC_DEFAULT_SCHOOL_ID`が正しいか確認
