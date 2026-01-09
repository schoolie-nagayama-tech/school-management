# 生徒管理システム

学習塾向けの生徒管理システムです。最小構成から始めて、段階的に機能を拡張していく設計になっています。

## 技術スタック

- **フレームワーク**: Next.js 14 (App Router)
- **言語**: TypeScript
- **データベース**: Supabase (PostgreSQL)
- **スタイリング**: Tailwind CSS

## 現在の機能（v1.0）

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
3. `.env.local.example`を`.env.local`にコピー
4. Supabaseの接続情報を設定

```bash
cp .env.local.example .env.local
```

`.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

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

## データベーススキーマ

### studentsテーブル

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| student_code | VARCHAR(20) | 生徒コード（ユニーク） |
| last_name | VARCHAR(50) | 姓 |
| first_name | VARCHAR(50) | 名 |
| last_name_kana | VARCHAR(50) | セイ |
| first_name_kana | VARCHAR(50) | メイ |
| grade | INTEGER | 学年（1-13） |
| status | VARCHAR(20) | 在籍状況 |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

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

## 拡張予定

今後追加予定の機能:

- [ ] 講師管理
- [ ] 授業スケジュール管理
- [ ] 出欠管理
- [ ] 成績管理
- [ ] 請求・入金管理
- [ ] 保護者ポータル
- [ ] 複数教室対応
- [ ] 認証機能

## ライセンス

Private
