# 生徒管理システム

学習塾向けの生徒管理システムです。最小構成から始めて、段階的に機能を拡張していく設計になっています。

## 技術スタック

- **フレームワーク**: Next.js 14 (App Router)
- **言語**: TypeScript
- **データベース**: Supabase (PostgreSQL)
- **スタイリング**: Tailwind CSS

## 現在の機能

### v1.5（最新）

- ✅ 生徒一覧表示（並び順ルール適用）
- ✅ 生徒新規登録
- ✅ 生徒情報編集
- ✅ 論理削除（soft delete）
- ✅ 氏名・フリガナ・コードで検索
- ✅ 教室（schools）概念の導入
- ✅ 作業ログ記録

### v1.0

- ✅ 生徒一覧表示
- ✅ 生徒新規登録
- ✅ 生徒情報編集
- ✅ 生徒削除
- ✅ 氏名・フリガナ・コードで検索

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. Supabaseの設定

1. [Supabase](https://supabase.com)でプロジェクトを作成
2. `supabase/schema.sql`の内容をSQL Editorで実行
3. デフォルト教室のIDを取得
   - SQL Editorで以下を実行:
   ```sql
   SELECT id FROM schools WHERE code = 'DEFAULT';
   ```
   - 表示されたUUIDをコピー
4. `.env.local.example`を`.env.local`にコピー
5. Supabaseの接続情報とデフォルト教室IDを設定

```bash
cp .env.local.example .env.local
```

`.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_DEFAULT_SCHOOL_ID=your-default-school-id
```

**重要（v1.5以降）**: `NEXT_PUBLIC_DEFAULT_SCHOOL_ID`には、上記手順3で取得したデフォルト教室のIDを設定してください。

#### 既存データがある場合の移行手順（v1.5）

既存の`students`テーブルにデータがある場合：

1. `supabase/schema.sql`を実行（既存データの移行処理が含まれています）
2. 移行が正常に完了したことを確認:
   ```sql
   SELECT COUNT(*) FROM students WHERE school_id IS NULL;
   ```
   - 結果が0であることを確認
3. デフォルト教室のIDを取得して`.env.local`に設定

### 3. 開発サーバーの起動

```bash
npm run dev
```

http://localhost:3000 でアクセス

## ディレクトリ構成

```
src/
├── app/                    # App Router
│   ├── layout.tsx          # ルートレイアウト
│   ├── page.tsx            # トップページ（/studentsへリダイレクト）
│   ├── globals.css         # グローバルCSS
│   └── students/
│       └── page.tsx        # 生徒管理ページ
├── components/
│   ├── ui/                 # 共通UIコンポーネント
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Select.tsx
│   │   ├── Modal.tsx
│   │   └── index.ts
│   └── students/           # 生徒関連コンポーネント
│       ├── StudentForm.tsx
│       ├── StudentTable.tsx
│       ├── DeleteConfirmDialog.tsx
│       └── index.ts
├── lib/
│   ├── supabase.ts         # Supabaseクライアント
│   └── api/
│       └── students.ts     # 生徒API関数
└── types/
    └── database.ts         # 型定義
```

## データベーススキーマ（v1.5）

### schoolsテーブル（教室）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| name | TEXT | 教室名 |
| code | TEXT | 教室コード（ユニーク、任意） |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

### studentsテーブル（生徒）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（外部キー） |
| student_code | VARCHAR(20) | 生徒コード（教室内ユニーク） |
| last_name | VARCHAR(50) | 姓 |
| first_name | VARCHAR(50) | 名 |
| last_name_kana | VARCHAR(50) | セイ |
| first_name_kana | VARCHAR(50) | メイ |
| grade | INTEGER | 学年（1-13） |
| status | VARCHAR(20) | 在籍状況 |
| school_name | VARCHAR(100) | 学校名（任意） |
| class_name | VARCHAR(50) | クラス（任意） |
| club | VARCHAR(100) | 部活（任意） |
| subject_other | VARCHAR(100) | 受講科目その他（任意） |
| deleted_at | TIMESTAMP | 論理削除日時（NULL=削除されていない） |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

**制約**: `UNIQUE(school_id, student_code)` - 生徒コードは教室内でユニーク

### student_logsテーブル（作業ログ）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| student_id | UUID | 生徒ID（外部キー） |
| school_id | UUID | 教室ID（外部キー） |
| action | TEXT | アクション（created/updated/soft_deleted/restored/status_changed） |
| actor | TEXT | 実行者（現在はNULL、将来はユーザーID） |
| diff | JSONB | 変更内容（変更前後の値） |
| created_at | TIMESTAMP | 作成日時 |

### 学年コード

| コード | 学年 |
|-------|------|
| 1-6 | 小1〜小6 |
| 7-9 | 中1〜中3 |
| 10-12 | 高1〜高3 |
| 13 | 既卒 |

### 在籍状況

| コード | 説明 |
|-------|------|
| active | 在籍中 |
| inactive | 休塾中 |
| withdrawn | 退塾 |

## v1.5の設計メモ

### 教室概念の暫定運用

- 現在は`NEXT_PUBLIC_DEFAULT_SCHOOL_ID`環境変数で固定の教室IDを使用
- すべてのCRUD操作はこの教室IDで絞り込まれる
- 将来、認証導入後はログインユーザーの`school_id`を使用するだけで拡張可能

### 論理削除

- 物理削除ではなく`deleted_at`に日時を設定
- 一覧・検索・編集対象は`deleted_at IS NULL`のみ
- 「退塾(withdrawn)」と「削除(deleted_at)」は別概念

### 作業ログ

- すべての作成・更新・削除操作を`student_logs`に記録
- ログ書き込み失敗時は警告のみ（処理自体は成功扱い）
- 将来、認証導入後は`actor`にユーザーIDを設定

### 並び順ルール

1. 在籍状況: active → inactive → withdrawn
2. 学年: 昇順（1〜13）
3. フリガナ: last_name_kana, first_name_kana 昇順（NULL/空は最後）
4. 氏名: last_name, first_name 昇順
5. 生徒コード: 昇順（タイブレーク）

## 拡張予定

今後追加予定の機能:

- [ ] 講師管理
- [ ] 授業スケジュール管理
- [ ] 出欠管理
- [ ] 成績管理
- [ ] 請求・入金管理
- [ ] 保護者ポータル
- [x] 複数教室対応（v1.5で基本実装済み）
- [ ] 認証機能（v1.5で設計準備済み）

## ライセンス

Private
