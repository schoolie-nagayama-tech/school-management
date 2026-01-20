# 生徒管理システム

学習塾向けの生徒管理システムです。最小構成から始めて、段階的に機能を拡張していく設計になっています。

## 技術スタック

- **フレームワーク**: Next.js 14 (App Router)
- **言語**: TypeScript
- **データベース**: Supabase (PostgreSQL)
- **スタイリング**: Tailwind CSS

## 現在の機能

### v4.0（最新）

- ✅ **講師出勤簿機能**
  - 講師勤怠ポータル（`/attendance/[schoolCode]`）
  - 講師別出勤簿入力（`/attendance/[schoolCode]/[teacherId]`）
  - コマ種別マスタ管理（教室別・科目別・時限別）
  - 出勤簿管理画面（教室別一覧・承認機能）
  - 月次集計・遅刻早退一覧
  - 講師はユーザー管理で管理（role='teacher'）
  - 詳細は後述

- ✅ **ユーザー管理機能**
  - 直接アカウント作成（招待メールなし）
  - 自動生成パスワード表示
  - ユーザー一覧・編集・削除
  - 講師・管理者・教室長などのロール管理
  - 教室との紐付け管理

- ✅ **ナビゲーション構造**
  - 講師勤怠ドロップダウン（出勤簿管理、月次集計、遅刻早退一覧、コマ種別設定）
  - フォーム管理ドロップダウン（回答、フォーム設定）

### v3.0

- ✅ **保護者向け申込ポータル**
  - スマホファーストのポータル画面（`/portal/[schoolCode]`）
  - 内部フォームと外部リンクの両方に対応
  - 公開期間に基づく自動的な表示制御
  - ドラッグ&ドロップによるメニュー並び替え
  - Toast通知によるユーザーフィードバック

- ✅ **フォーム回答管理基盤**
  - 共通の回答保存・管理システム（`form_responses`テーブル）
  - フォーム公開期間管理（`form_periods`テーブル）
  - 回答一覧表示・フィルタリング機能
  - 生徒への紐付け機能
  - 申込状況との自動連携

- ✅ **増コマ申込フォーム（Zoukoma）**
  - 科目別コマ数入力
  - 学年別単価による料金自動計算
  - 3週間分の日程スロット選択（時限・日付）
  - 行・列の一括チェック機能
  - 回答一覧・集計・ステータス管理
  - 詳細は後述

- ✅ **Vもぎ申込フォーム（Mogi）**
  - 日程・会場選択
  - キャンセル不可確認
  - 回答一覧・集計機能
  - 詳細は後述

### v2.0

- ✅ **成績管理**
  - 学校定期テスト・学校内申・COM・模試の成績を登録・編集
  - スプレッドシート風の表形式UI
  - 行追加・セル編集機能
  - 5科合計・9科合計・平均の自動計算
  - プルダウン選択によるテスト名・内申名・模試名の統一
  - 年月（YYYY-MM）形式での日付管理
  - 成績時点の学年を記録（学年跨ぎの変遷を可視化）

### v1.5

- ✅ 生徒一覧表示（並び順ルール適用）
- ✅ 生徒新規登録
- ✅ 生徒情報編集
- ✅ 論理削除（soft delete）
- ✅ 氏名・フリガナ・コードで検索
- ✅ 教室（schools）概念の導入
- ✅ 作業ログ記録
- ✅ 科目マスタ管理（学年カテゴリ別）
- ✅ 生徒の受講科目複数選択対応
- ✅ 生徒詳細表示モーダル

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
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**重要**:
- `NEXT_PUBLIC_DEFAULT_SCHOOL_ID`: 上記手順3で取得したデフォルト教室のIDを設定してください（v1.5以降）
- `SUPABASE_SERVICE_ROLE_KEY`: Supabaseのプロジェクト設定から取得したService Role Keyを設定してください（v4.0以降、ユーザー管理・講師出勤簿機能で使用）

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
│   ├── students/           # 生徒管理
│   │   └── page.tsx
│   ├── attendance/         # 講師出勤簿（講師向け）
│   │   └── [schoolCode]/
│   │       ├── page.tsx    # 講師勤怠ポータル
│   │       └── [teacherId]/
│   │           └── page.tsx # 出勤簿入力
│   ├── admin/              # 管理画面
│   │   ├── attendance/     # 出勤簿管理
│   │   │   ├── page.tsx    # 出勤簿一覧
│   │   │   ├── summary/    # 月次集計
│   │   │   ├── late-early/ # 遅刻早退一覧
│   │   │   └── sheets/     # 出勤簿詳細
│   │   └── settings/
│   │       └── attendance-types/ # コマ種別設定
│   ├── users/              # ユーザー管理
│   │   └── page.tsx
│   └── api/                # API Routes
│       └── admin/
│           └── users/      # ユーザー管理API
├── components/
│   ├── ui/                 # 共通UIコンポーネント
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Select.tsx
│   │   ├── Card.tsx
│   │   └── index.ts
│   ├── layout/             # レイアウトコンポーネント
│   │   ├── AppHeader.tsx   # アプリケーションヘッダー
│   │   └── AdminLayout.tsx # 管理画面レイアウト
│   └── students/           # 生徒関連コンポーネント
│       └── ...
├── lib/
│   ├── supabase.ts         # Supabaseクライアント
│   ├── utils/
│   │   └── password.ts     # パスワード生成ユーティリティ
│   └── api/
│       ├── students.ts     # 生徒API関数
│       ├── subjects.ts     # 科目API関数
│       ├── assessments.ts # 成績API関数
│       ├── schools.ts      # 教室API関数
│       ├── auth.ts         # 認証・ユーザーAPI関数
│       └── attendance.ts   # 出勤簿API関数
└── types/
    ├── database.ts         # 型定義
    └── attendance.ts       # 出勤簿型定義
```

## データベーススキーマ

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

### subjectsテーブル（科目マスタ）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| name | VARCHAR(50) | 科目名 |
| grade_category | VARCHAR(20) | 学年カテゴリ（elementary/middle/high） |
| sort_order | INTEGER | 表示順 |
| created_at | TIMESTAMP | 作成日時 |

### student_subjectsテーブル（生徒と科目の中間テーブル）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| student_id | UUID | 生徒ID（外部キー） |
| subject_id | UUID | 科目ID（外部キー） |
| created_at | TIMESTAMP | 作成日時 |

**制約**: `UNIQUE(student_id, subject_id)` - 1人の生徒に対して同じ科目は1回のみ

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

### assessmentsテーブル（成績行）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（外部キー） |
| student_id | UUID | 生徒ID（外部キー） |
| category | TEXT | カテゴリ（regular_test/report_card/mock） |
| title | TEXT | タイトル（互換性のため残す） |
| name_code | TEXT | プルダウン選択値（必須） |
| exam_date | DATE | 試験日（互換性のため残す） |
| exam_month | DATE | 年月（YYYY-MM-01形式） |
| grade | INTEGER | その成績時点の学年（1-13、必須） |
| term | TEXT | 学期（将来の拡張用） |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

**name_codeの選択肢**:
- `regular_test`: term1_mid, term1_final, term2_mid, term2_final, year_end, first_mid, first_final, second_mid, second_final
- `report_card`: term1, term2, year_end, first, second
- `mock`: venue, classroom

### assessment_scoresテーブル（成績スコア）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| assessment_id | UUID | 成績行ID（外部キー） |
| subject | TEXT | 科目コード（english, math, japanese, social, science, music, art, tech_home, pe, conv_5, conv_4, conv_total） |
| value | NUMERIC | 点数 |
| created_at | TIMESTAMP | 作成日時 |

**制約**: `UNIQUE(assessment_id, subject)` - 1つの成績行に対して同じ科目は1回のみ

### portal_menuテーブル（ポータルメニュー項目）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（外部キー） |
| menu_key | TEXT | 項目識別子（zoukoma/moshi/mendan/mogi/shukaisu/youbi/kyozai/soudan） |
| title | TEXT | 表示名 |
| description | TEXT | 説明文 |
| link_type | TEXT | リンク種別（internal: 内部フォーム / external: 外部URL） |
| link_url | TEXT | リンク先URL（external の場合は外部URL、internal の場合は内部パス） |
| is_visible | BOOLEAN | 表示フラグ（デフォルト: true） |
| sort_order | INTEGER | 表示順 |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

**制約**: `UNIQUE(school_id, menu_key)`

### application_itemsテーブル（申込項目）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（外部キー） |
| name | TEXT | 項目名 |
| is_active | BOOLEAN | 有効フラグ |
| sort_order | INTEGER | 表示順 |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

### student_applicationsテーブル（生徒の申込状況）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（外部キー） |
| student_id | UUID | 生徒ID（外部キー） |
| item_id | UUID | 申込項目ID（外部キー） |
| status | TEXT | 申込状況（null: 未登録、'not_applied': 未申込、'completed': 申込済み、'not_applicable': 対象外） |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

**制約**: `UNIQUE(student_id, item_id)`

### user_profilesテーブル（ユーザープロファイル）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー（Supabase AuthのユーザーID） |
| email | TEXT | メールアドレス |
| display_name | TEXT | 表示名（任意） |
| role | TEXT | ロール（admin/owner/manager/teacher/parent） |
| is_active | BOOLEAN | 有効フラグ |
| invited_by | UUID | 招待者ID（任意） |
| invited_at | TIMESTAMP | 招待日時（任意） |
| last_login_at | TIMESTAMP | 最終ログイン日時（任意） |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

### user_schoolsテーブル（ユーザーと教室の紐付け）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| user_id | UUID | ユーザーID（外部キー） |
| school_id | UUID | 教室ID（外部キー） |
| created_at | TIMESTAMP | 作成日時 |

**制約**: `UNIQUE(user_id, school_id)`

### attendance_sheetsテーブル（出勤簿）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| teacher_id | UUID | 講師ID（user_profiles.id、外部キー） |
| school_id | UUID | 教室ID（外部キー） |
| year_month | TEXT | 年月（YYYY-MM形式） |
| status | TEXT | ステータス（draft/submitted/approved/rejected） |
| submitted_at | TIMESTAMP | 提出日時（任意） |
| approved_at | TIMESTAMP | 承認日時（任意） |
| approved_by | UUID | 承認者ID（user_profiles.id、外部キー、任意） |
| rejection_reason | TEXT | 修正理由（任意） |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

**制約**: `UNIQUE(teacher_id, school_id, year_month)`

### attendance_typesテーブル（コマ種別マスタ）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（外部キー） |
| subject | TEXT | 科目名 |
| period | TEXT | 時限（例: "4限", "5限"） |
| unit | TEXT | 単位（例: "コマ", "時間"） |
| unit_price | NUMERIC | 単価 |
| is_active | BOOLEAN | 有効フラグ |
| display_order | INTEGER | 表示順 |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

### attendance_recordsテーブル（出勤簿明細）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| sheet_id | UUID | 出勤簿ID（外部キー） |
| date | DATE | 日付 |
| attendance_type_id | UUID | コマ種別ID（外部キー） |
| value | NUMERIC | コマ数 |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

**制約**: `UNIQUE(sheet_id, date, attendance_type_id)`

### attendance_notesテーブル（備考・遅刻早退記録）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| sheet_id | UUID | 出勤簿ID（外部キー） |
| date | DATE | 日付 |
| late_early | TEXT | 遅刻・早退内容（任意） |
| note | TEXT | 備考（任意） |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

**制約**: `UNIQUE(sheet_id, date)`

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

### フォーム種別

| コード | 説明 |
|-------|------|
| zoukoma | 増コマ申込 |
| moshi | 模試申込 |
| mogi | Vもぎ申込 |
| shukaisu | 週回数変更 |
| youbi | 曜日変更 |
| kyozai | 教材販売 |
| soudan | お客様相談 |

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

## v2.0の設計メモ

### 成績管理

- **カテゴリ別管理**: 定期テスト、内申、模試を分けて管理
- **プルダウン選択**: テスト名・内申名・模試名をプルダウンで統一
- **年月管理**: 日付ではなく年月（YYYY-MM）で管理し、学年跨ぎの変遷を可視化
- **学年記録**: 各成績行に「その成績時点の学年」を記録（現在の学年とは別）
- **自動計算**: 5科合計、9科合計、平均をフロントエンドで自動計算
- **科目コード**: 固定の科目コード（english, math, japanese等）を使用

### 科目管理

- **学年カテゴリ別**: 小学生（elementary）、中学生（middle）、高校生（high）で科目を分類
- **複数選択**: 1人の生徒が複数の科目を受講可能
- **設定画面**: 科目の追加・編集・削除・並び替えが可能

## v3.0の設計メモ

### 保護者向けポータル

- **スマホファースト**: モバイルデバイスでの利用を最優先に設計
- **公開期間管理**: `publish_start`と`publish_end`に基づく自動的な表示制御
- **内部フォームと外部リンク**: 両方のリンク種別に対応
- **ドラッグ&ドロップ**: `@dnd-kit`を使用した直感的な並び替えUI

### フォーム回答管理基盤

- **共通テーブル設計**: `form_responses`と`form_periods`で全フォーム種別を統一管理
- **JSONBによる柔軟な設定**: フォーム固有の設定や回答データを`JSONB`で保存
- **自動ステータス計算**: 公開期間に基づいて`is_active`を自動計算
- **申込状況連携**: `linked_application_item_id`による自動的な申込状況更新

### 増コマ申込フォーム

- **科目別コマ数入力**: 科目ごとに個別にコマ数を入力可能
- **学年別単価**: 学年ごとに異なる単価を設定可能
- **料金自動計算**: 合計コマ数 × 単価で自動計算
- **日程スロット選択**: 3週間分（21日間）の日程から選択
- **一括チェック機能**: 行（日付）・列（時限）ごとの全選択/全解除
- **ステータス管理**: 計上・座席落とし込みのチェックボックス管理
- **生徒紐付け**: 同じ学年の生徒一覧から選択して紐付け

### Vもぎ申込フォーム

- **日程・会場選択**: 複数日程から選択、各日程に複数会場を設定可能
- **キャンセル不可確認**: 必須チェックボックスによる確認
- **集計機能**: 日程・会場別の申込数を集計表示

### UI/UX改善

- **Toast通知**: `alert()`を廃止し、非侵入的なToast通知を実装
- **URLバリデーション**: 外部リンクのURL形式を厳密にチェック
- **ドラッグ&ドロップ**: 並び替え操作を直感的に改善
- **視覚的フィードバック**: 選択状態や公開状態を色分けで表示

## v4.0の設計メモ

### 講師出勤簿機能

- **講師データの統合**: `teachers`テーブルを廃止し、`user_profiles`（`role='teacher'`）で管理
- **教室との紐付け**: `user_schools`テーブルで講師と教室を紐付け
- **ワークフロー**: 下書き → 提出 → 承認/修正の3段階ステータス管理
- **コマ種別マスタ**: 教室別・科目別・時限別のコマ種別を設定可能
- **月次管理**: 年月（YYYY-MM）単位で出勤簿を管理

### ユーザー管理機能

- **直接アカウント作成**: 招待メールなしで管理者が直接アカウントを作成
- **自動パスワード生成**: 8文字のランダムパスワードを自動生成（英大文字・小文字・数字、見間違い防止のためI/O/0/1を除外）
- **Service Role Key**: サーバーサイドでのユーザー作成・削除に`SUPABASE_SERVICE_ROLE_KEY`を使用

### ナビゲーション構造

- **講師勤怠ドロップダウン**: 出勤簿管理、月次集計、遅刻早退一覧、コマ種別設定を統合
- **フォーム管理ドロップダウン**: 回答、フォーム設定を統合
- **統一ヘッダー**: すべてのページで`AppHeader`コンポーネントを使用

### データ取得の最適化

- **JOIN回避**: SupabaseのPostgRESTで直接JOINが困難な場合、別々に取得してマッピング
- **Promise.all**: 複数の関連データを並列取得してパフォーマンス向上

## v3.0の詳細機能

### 保護者向け申込ポータル

**URL**: `/portal/[schoolCode]`

保護者・生徒がスマホからアクセスする申込ポータル画面です。

**主な機能**:
- 教室コードに基づくポータル表示
- 内部フォーム（増コマ申込、Vもぎ申込など）と外部リンク（面談予約など）の両方に対応
- 公開期間に基づく自動的な表示制御（公開期間外は「準備中」表示）
- レスポンシブデザイン（スマホファースト）

**ポータルメニュー項目**:
- 増コマ申し込み（内部フォーム）
- 模試申し込み（内部フォーム、未実装）
- 面談申し込み（外部リンク）
- Vもぎ申し込み（内部フォーム）
- 週回数変更（内部フォーム、未実装）
- 曜日変更申し込み（内部フォーム、未実装）
- 教材販売（内部フォーム、未実装）
- お客様相談（内部フォーム、未実装）

### フォーム回答管理基盤

**データベーステーブル**:

#### `form_responses`テーブル
| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（外部キー） |
| form_type | TEXT | フォーム種別（zoukoma/moshi/mogi/shukaisu/youbi/kyozai/soudan） |
| form_period | TEXT | フォーム期間識別子（例: 2024-10, 2024-11） |
| student_name | TEXT | 生徒名（手入力） |
| grade | INTEGER | 学年（1-13） |
| email | TEXT | メールアドレス |
| response_data | JSONB | フォーム固有の回答データ |
| linked_student_id | UUID | 紐付けた生徒ID（外部キー、任意） |
| linked_at | TIMESTAMP | 紐付け日時 |
| status_checks | JSONB | 管理用チェック状態（例: {"charged": true, "seated": false}） |
| created_at | TIMESTAMP | 回答日時 |
| updated_at | TIMESTAMP | 更新日時 |

#### `form_periods`テーブル
| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（外部キー） |
| form_type | TEXT | フォーム種別 |
| period_key | TEXT | 期間識別子（例: 2024-10） |
| title | TEXT | 表示タイトル（例: 10月度 増コマ申込） |
| settings | JSONB | フォーム固有の設定（可変項目：日程、単価、会場など） |
| publish_start | TIMESTAMP | 公開開始日時 |
| publish_end | TIMESTAMP | 公開終了日時 |
| is_active | BOOLEAN | 有効フラグ（公開期間に基づいて自動計算） |
| linked_application_item_id | UUID | 申込状況項目との紐付け（任意） |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

**制約**: `UNIQUE(school_id, form_type, period_key)`

**主な機能**:
- フォーム回答の保存・取得
- 回答一覧表示・フィルタリング（学年、紐付け状態、ステータスチェック）
- 生徒への紐付け・解除
- 申込状況との自動連携（紐付け時に自動更新）

### 増コマ申込フォーム（Zoukoma）

**URL（保護者向け）**: `/portal/[schoolCode]/zoukoma`  
**URL（管理画面）**: `/settings/forms/zoukoma`  
**回答一覧**: `/forms/responses/zoukoma/[periodKey]`

#### 機能概要

追加授業のお申込みフォームです。科目ごとのコマ数入力、料金自動計算、日程選択機能を備えています。

#### 保護者向けフォーム機能

1. **基本情報入力**
   - 生徒名（必須）
   - 学年（必須、デフォルトは空欄）
   - メールアドレス（必須）

2. **科目別コマ数入力**
   - 設定された科目ごとにコマ数を入力
   - 合計コマ数の自動計算
   - 学年別単価による料金自動計算

3. **出席可能日程選択**
   - 3週間分（21日間）の日程スロットを表示
   - 日曜日は除外
   - 時限（4限、5限、6限、7限）ごとの選択
   - **一括チェック機能**:
     - 行（日付）ごとの全選択/全解除
     - 列（時限）ごとの全選択/全解除
     - 視覚的フィードバック（全選択時はオレンジ背景で「✓」表示）

4. **料金表示**
   - 単価（学年別）
   - 合計コマ数
   - 合計金額（自動計算）

5. **備考入力**（任意）

#### 管理画面機能

**期間設定ページ** (`/settings/forms/zoukoma`):

1. **期間一覧表示**
   - 期間キー、タイトル、公開期間、ステータス、回答数を表示
   - ステータス表示:
     - 公開中（緑）
     - 公開前（黄）
     - 公開終了（灰）
     - 未設定（灰）

2. **期間作成・編集**
   - マルチステップフォーム:
     - **Step 1**: 基本情報（期間キー、タイトル、説明、公開期間）
     - **Step 2**: 対象学年・単価設定
     - **Step 3**: 科目設定
     - **Step 4**: 日程スケジュール設定
     - **Step 5**: 完了メッセージ・申込状況項目紐付け
   - 前回設定からのコピー機能
   - 公開期間の自動設定（新規作成時は現在時刻〜30日後）

3. **期間削除**
   - 確認ダイアログ付き削除機能

**回答一覧ページ** (`/forms/responses/zoukoma/[periodKey]`):

1. **集計表示**
   - 合計コマ数
   - 合計金額
   - 計上済み件数
   - 座席落とし込み済み件数

2. **フィルター**
   - 学年
   - 計上状態（全て/計上済み/未計上）
   - 座席状態（全て/座席落とし込み済み/未落とし込み）

3. **回答一覧テーブル**
   - 回答日時
   - 生徒名
   - 学年
   - 科目内訳
   - コマ数
   - 金額
   - 計上チェックボックス（クリックで更新）
   - 座席チェックボックス（クリックで更新）
   - 紐付け状態（済/未）
   - 操作（詳細、紐付け/解除）

4. **生徒紐付け機能**
   - 同じ学年の生徒一覧を表示
   - 生徒選択による紐付け
   - 紐付け時に申込状況を自動更新（`linked_application_item_id`が設定されている場合）

#### データ構造

**設定（`form_periods.settings`）**:
```typescript
{
  description?: string; // 説明文
  grades?: string[]; // 対象学年（例: ["中1", "中2", "中3"]）
  price_table?: Record<string, number>; // 学年別単価（例: {"中1": 3980, "中2": 3980}）
  subjects?: string[]; // 科目リスト（例: ["英語", "数学", "国語"]）
  schedule?: {
    start_date: string; // 開始日（YYYY-MM-DD）
    min_days_ahead: number; // 申込可能な最短日（デフォルト: 2）
    periods: Array<{
      code: string; // 時限コード（"4", "5", "6", "7"）
      start_time: string; // 開始時刻（例: "14:25"）
      end_time: string; // 終了時刻（例: "15:55"）
      available_saturday: boolean; // 土曜日に表示するか
      available_weekday: boolean; // 平日に表示するか
    }>;
  };
  completion_message?: string; // 完了メッセージ
}
```

**回答データ（`form_responses.response_data`）**:
```typescript
{
  subjects: Record<string, number>; // 科目ごとのコマ数（例: {"英語": 2, "数学": 3}）
  total_koma: number; // 合計コマ数
  unit_price: number; // 単価（学年別）
  total_fee: number; // 合計金額
  selected_slots: Array<{
    id: string; // スロットID（例: "20241015_5"）
    label: string; // 表示ラベル（例: "10/15(火) 5限 16:20–17:50"）
  }>;
  slot_count: number; // 選択したスロット数
  note?: string; // 備考
}
```

### Vもぎ申込フォーム（Mogi）

**URL（保護者向け）**: `/portal/[schoolCode]/mogi`  
**URL（管理画面）**: `/settings/forms/mogi`  
**回答一覧**: `/forms/responses/mogi/[periodKey]`

#### 機能概要

Vもぎ模擬試験のお申込みフォームです。日程・会場選択機能を備えています。

#### 保護者向けフォーム機能

1. **基本情報入力**
   - 生徒名（必須）
   - 学年（必須）
   - メールアドレス（必須）

2. **日程・会場選択**
   - 設定された日程一覧から選択
   - 各日程ごとに会場を選択
   - 複数日程の選択が可能

3. **キャンセル不可確認**
   - チェックボックスによる確認（必須）

4. **備考入力**（任意）

#### 管理画面機能

**期間設定ページ** (`/settings/forms/mogi`):

1. **期間一覧表示**
   - 期間キー、タイトル、公開期間、ステータス、回答数を表示

2. **期間作成・編集**
   - 基本情報（期間キー、タイトル、公開期間）
   - 対象学年設定
   - 日程・会場設定（複数日程、各日程に複数会場）

**回答一覧ページ** (`/forms/responses/mogi/[periodKey]`):

1. **集計表示**
   - 日程・会場別の申込数
   - 計上済み件数
   - 紐付け済み件数

2. **フィルター**
   - 学年
   - 日程
   - 会場
   - 計上状態
   - 紐付け状態

3. **回答一覧テーブル**
   - 回答日時、生徒名、学年、選択日程・会場、計上状態、紐付け状態、操作

#### データ構造

**設定（`form_periods.settings`）**:
```typescript
{
  description?: string; // 説明文
  grades?: string[]; // 対象学年（例: ["中3"]）
  dates?: Array<{
    id: string; // 日程ID（YYYY-MM-DD形式）
    label: string; // 表示ラベル（例: "10月6日（日）"）
    venues: Array<{
      id: string; // 会場ID
      label: string; // 会場名
    }>;
  }>;
  completion_message?: string; // 完了メッセージ
}
```

**回答データ（`form_responses.response_data`）**:
```typescript
{
  selections: Array<{
    date_id: string; // 日程ID
    date_label: string; // 日程ラベル
    venue_id: string; // 会場ID
    venue_label: string; // 会場ラベル
  }>;
  selection_count: number; // 選択数
  cancel_agreed: boolean; // キャンセル不可確認
  note?: string; // 備考
}
```

### ポータル設定ページ

**URL**: `/settings/portal`

ポータルメニューの管理画面です。

**主な機能**:
- ポータルURL表示・コピー
- メニュー項目一覧表示（表示状態、タイトル、公開状況、操作）
- メニュー項目の編集（タイトル、説明、表示/非表示、リンク種別、リンク先URL）
- ドラッグ&ドロップによる並び替え
- 期間公開設定の編集（内部フォームの場合）
- Toast通知によるユーザーフィードバック

**公開状況の表示**:
- 内部フォーム: 公開中の期間名を表示（例: "公開中(10月度)"）
- 外部リンク: URL設定状態を表示
- 未設定・公開期間外: "準備中"または"公開なし"を表示

### フォーム回答一覧ページ（共通）

**URL**: `/forms/responses`

全フォーム種別の回答を一覧表示する共通ページです。

**主な機能**:
- フォーム種別フィルター
- 期間フィルター
- 学年フィルター
- 紐付け状態フィルター
- 回答一覧表示（回答日時、種別、期間、生徒名、学年、紐付け状態、操作）

## v4.0の詳細機能

### 講師出勤簿機能

**URL（講師向けポータル）**: `/attendance/[schoolCode]`  
**URL（講師入力）**: `/attendance/[schoolCode]/[teacherId]`  
**URL（管理画面）**: `/admin/attendance`

#### 機能概要

講師の出勤簿を管理する機能です。講師が月次で出勤コマ数を入力し、管理者が承認するワークフローを実装しています。

#### 講師向け機能

1. **講師勤怠ポータル** (`/attendance/[schoolCode]`)
   - 教室コードに基づく講師一覧表示
   - 各講師の出勤簿ステータス表示（未入力、下書き、提出済み、承認済み、修正）
   - 合計コマ数表示
   - 年月選択機能

2. **出勤簿入力** (`/attendance/[schoolCode]/[teacherId]`)
   - 月次カレンダー形式の入力画面
   - コマ種別ごとのコマ数入力
   - 遅刻・早退の備考入力
   - 下書き保存・提出機能
   - 提出後の取り下げ機能（提出済みステータスの場合のみ）

#### 管理画面機能

1. **出勤簿管理** (`/admin/attendance`)
   - 教室別・年月別の出勤簿一覧
   - 講師名・ステータス・合計コマ数表示
   - 一括承認機能
   - 個別承認・修正機能
   - 修正理由の入力

2. **月次集計** (`/admin/attendance/summary`)
   - 教室別・年月別の集計表示
   - 講師別のコマ種別内訳
   - 合計コマ数・合計金額の表示

3. **遅刻・早退一覧** (`/admin/attendance/late-early`)
   - 遅刻・早退の記録一覧
   - 講師名・教室名・日付・内容表示
   - フィルタリング機能

4. **コマ種別設定** (`/admin/settings/attendance-types`)
   - 教室別のコマ種別マスタ管理
   - 科目・時限・単位・単価の設定
   - 表示順の管理

#### データ構造

**講師データ**:
- `user_profiles`テーブルで管理（`role='teacher'`）
- `user_schools`テーブルで教室との紐付け
- `display_name`または`email`を講師名として表示

**出勤簿ステータス**:
- `draft`: 下書き
- `submitted`: 提出済み（講師から見た表示）
- `approved`: 承認済み
- `rejected`: 修正（管理者から見た表示）

#### データベーステーブル

- `attendance_sheets`: 出勤簿（講師・教室・年月ごと）
- `attendance_types`: コマ種別マスタ（教室別）
- `attendance_records`: 出勤簿明細（日付・コマ種別・コマ数）
- `attendance_notes`: 備考・遅刻早退記録

詳細は後述のデータベーススキーマを参照してください。

## 拡張予定

今後追加予定の機能:

- [x] 講師管理（v4.0で実装済み、ユーザー管理に統合）
- [x] 講師出勤簿機能（v4.0で実装済み）
- [ ] 授業スケジュール管理
- [ ] 出欠管理
- [x] 成績管理（v2.0で実装済み）
- [ ] 請求・入金管理
- [x] 保護者ポータル（v3.0で実装済み）
- [x] 複数教室対応（v1.5で基本実装済み）
- [x] 認証機能（v1.5で設計準備済み、v4.0で実装済み）
- [ ] 模試申込フォーム（Moshi）
- [ ] 週回数変更フォーム（Shukaisu）
- [ ] 曜日変更フォーム（Youbi）
- [ ] 教材販売フォーム（Kyozai）
- [ ] お客様相談フォーム（Soudan）

## ライセンス

Private
