# 申込フォーム機能 仕様書

## 概要

学習塾向けの保護者向け申込フォームシステムです。Google Formsのような動的フォーム作成機能と、特別なカスタムフォーム（増コマ申込）を提供します。

## データベース設計

### テーブル構成

#### 1. form_templates（フォームテンプレート）
フォームのテンプレートを管理するマスタテーブル。

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（外部キー） |
| name | TEXT | テンプレート名 |
| description | TEXT | 説明 |
| created_at | TIMESTAMPTZ | 作成日時 |
| updated_at | TIMESTAMPTZ | 更新日時 |

#### 2. form_template_fields（テンプレート項目）
テンプレートに含まれる項目定義。

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| template_id | UUID | テンプレートID（外部キー） |
| field_type | TEXT | フィールドタイプ（text/textarea/select/radio/checkbox/date/number） |
| label | TEXT | ラベル（必須） |
| placeholder | TEXT | プレースホルダー |
| options | JSONB | 選択肢（select/radio/checkbox用）または設定（number用: min/max/step） |
| is_required | BOOLEAN | 必須フラグ |
| sort_order | INTEGER | 表示順 |
| created_at | TIMESTAMPTZ | 作成日時 |

#### 3. forms（公開フォーム）
実際に保護者に公開されるフォーム。

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（外部キー） |
| template_id | UUID | テンプレートID（外部キー、任意） |
| title | TEXT | フォームタイトル |
| description | TEXT | 説明 |
| slug | TEXT | URLスラッグ（school_idとユニーク） |
| status | TEXT | 状態（draft/published/closed） |
| publish_start | TIMESTAMPTZ | 公開開始日時（任意） |
| publish_end | TIMESTAMPTZ | 公開終了日時（任意） |
| completion_message | TEXT | 送信完了メッセージ |
| linked_application_item_id | UUID | 紐付ける申込状況項目ID（任意） |
| created_at | TIMESTAMPTZ | 作成日時 |
| updated_at | TIMESTAMPTZ | 更新日時 |

**制約**: `UNIQUE(school_id, slug)`

#### 4. form_fields（フォーム項目）
フォームに含まれる項目定義（form_template_fieldsからコピー可能）。

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| form_id | UUID | フォームID（外部キー） |
| field_type | TEXT | フィールドタイプ |
| label | TEXT | ラベル |
| placeholder | TEXT | プレースホルダー |
| options | JSONB | 選択肢または設定 |
| is_required | BOOLEAN | 必須フラグ |
| sort_order | INTEGER | 表示順 |
| created_at | TIMESTAMPTZ | 作成日時 |

#### 5. form_responses（回答）
保護者からの回答データ。

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| form_id | UUID | フォームID（外部キー） |
| school_id | UUID | 教室ID（外部キー） |
| student_name | TEXT | 生徒名（必須） |
| grade | INTEGER | 学年（1-13、必須） |
| email | TEXT | メールアドレス |
| answers | JSONB | 回答内容（`{ "field_id": "answer_value", ... }`） |
| linked_student_id | UUID | 紐付けられた生徒ID（任意） |
| linked_at | TIMESTAMPTZ | 紐付け日時 |
| created_at | TIMESTAMPTZ | 回答日時 |

### フィールドタイプ

#### text
- 1行テキスト入力
- `options`: 未使用

#### textarea
- 複数行テキスト入力
- `options`: 未使用

#### select
- プルダウン選択
- `options`: `["選択肢1", "選択肢2", ...]` 形式の配列

#### radio
- ラジオボタン選択
- `options`: `["選択肢1", "選択肢2", ...]` 形式の配列

#### checkbox
- チェックボックス（複数選択可）
- `options`: `["選択肢1", "選択肢2", ...]` 形式の配列
- 回答は配列形式で保存: `["選択肢1", "選択肢2"]`

#### date
- 日付選択
- `options`: 未使用

#### number
- 数値入力
- `options`: `{ "min": 0, "max": 100, "step": 1 }` 形式のオブジェクト

### 共通フィールド

すべてのフォームに以下のフィールドが暗黙的に含まれます（`form_fields`には保存されない）：

1. **生徒名** (text, 必須)
2. **学年** (select, 必須)
   - 選択肢: 小1, 小2, 小3, 小4, 小5, 小6, 中1, 中2, 中3, 高1, 高2, 高3, 既卒
   - データベースには数値（1-13）で保存
3. **メールアドレス** (email, 必須)

## 機能一覧

### 1. フォーム管理画面（管理者向け）

**URL**: `/forms/manage`

#### テンプレート管理
- テンプレート一覧表示
- テンプレート作成・編集・削除
- テンプレート項目の追加・編集・削除・並び替え
- テンプレートからフォームを作成

#### フォーム管理
- フォーム一覧表示（状態、公開期間、回答数）
- フォーム作成（テンプレートから、または手動）
- フォーム編集（メタデータ、項目、公開設定）
- フォーム削除
- 状態管理（下書き/公開中/終了）
- 公開URL取得（リンク取得ボタン）
- プレビュー機能（確認ボタン）

#### 回答管理
- 回答一覧表示（フィルター: 学年、紐付け状態）
- 回答詳細表示
- 回答と生徒の紐付け・解除
- 申込状況との自動連携

### 2. 保護者向けポータル

**URL**: `/portal/[schoolCode]`

- 公開中のフォーム一覧を表示
- 公開期間内のフォームのみ表示
- カード形式で表示（タイトル、説明、終了日、回答ボタン）
- フォームが無い場合は「現在受付中のお申込みはありません」を表示

### 3. フォーム回答ページ

**URL**: `/portal/[schoolCode]/[formSlug]`

#### アクセス制御
- `status = 'published'` のみアクセス可能
- `publish_start` 以前はアクセス不可
- `publish_end` 以降はアクセス不可
- 条件を満たさない場合は「このフォームは現在受付していません」を表示

#### フォーム表示
- 共通フィールド（生徒名、学年、メール）を表示
- カスタムフィールドを `sort_order` 順に表示
- 必須項目には `*` マーク
- バリデーションエラーを表示

#### 送信処理
- 送信ボタンクリックで回答を保存
- 送信中はボタンを無効化（二重送信防止）
- 送信成功後、完了画面を表示（`completion_message`）
- 完了画面からポータルに戻る

### 4. 増コマ申込フォーム（特別なカスタムフォーム）

**スラッグ**: `test-koma`

#### 概要
定期テスト対策のための追加授業（増コマ）申込フォーム。GASフォームを移植した特別なUIを持つ。

#### テンプレート定義
- **テンプレート名**: 「増コマ申込（テスト対策）」
- **項目**:
  1. 英語（コマ）: number, min=0, max=60, step=1
  2. 数学（コマ）: number, min=0, max=60, step=1
  3. 国語（コマ）: number, min=0, max=60, step=1
  4. 理科（コマ）: number, min=0, max=60, step=1
  5. 社会（コマ）: number, min=0, max=60, step=1
  6. 出席可能日程: checkbox（optionsは空配列、UIで動的生成）
  7. 備考: textarea

#### UI構成
1. **ヒーローセクション**
   - フォームタイトルと説明

2. **基本情報**
   - 生徒名、学年、メールアドレス（共通フィールド）

3. **科目別コマ数入力**
   - 5科目（英語、数学、国語、理科、社会）のコマ数を入力
   - 各科目: 0-60コマ、整数のみ

4. **価格表・見積もり**
   - 学年別単価表を表示
   - 合計コマ数 × 単価で見積金額を計算・表示
   - 内訳（科目別コマ数 × 単価）を表示

5. **出席可能日程選択**
   - 21日分のスロットを表示（今日+2日から開始）
   - 日曜日は除外
   - 平日: 5限（16:20-17:50）、6限（17:50-19:20）、7限（19:20-20:50）
   - 土曜: 4限（14:50-16:20）、5限、6限、7限
   - 選択機能:
     - 個別選択（チェックボックス）
     - 列選択（時間帯ごと）
     - 行選択（日付ごと）
     - 全選択/全解除

6. **備考**
   - テキストエリア

7. **送信ボタン**
   - リセットボタンと送信ボタン

#### バリデーション
- 必須項目チェック（生徒名、学年、メール）
- メールアドレス形式チェック
- 合計コマ数が0の場合、確認ダイアログを表示

#### データ保存
- `student_name`: 入力値
- `grade`: 学年ラベル（中1など）を数値（7-12）に変換
- `email`: 入力値
- `answers`:
  - 科目コマ数: `{ "field_id": number }`
  - スロット: `{ "field_id": ["slot_id1", "slot_id2", ...] }`
  - 備考: `{ "field_id": "text" }`

#### 学年変換
- 中1 → 7
- 中2 → 8
- 中3 → 9
- 高1 → 10
- 高2 → 11
- 高3 → 12

#### 価格設定
| 学年 | 単価（円/コマ） |
|------|----------------|
| 中1 | 3,980 |
| 中2 | 3,980 |
| 中3 | 4,480 |
| 高1 | 4,980 |
| 高2 | 4,980 |
| 高3 | 4,980 |

#### スロット生成ロジック
- 開始日: 今日 + 2日
- 期間: 21日間
- 日曜日を除外
- スロットID形式: `yyyyMMdd_code`（例: `20250115_5`）
- ラベル形式: `M/d(E) + "5限 16:20–17:50"`

### 5. 回答管理機能

**URL**: `/forms/responses/[formId]`

#### 機能
- 回答一覧表示（回答日時、生徒名、学年、メール、紐付け状態）
- フィルター（学年、紐付け状態）
- 回答詳細表示（モーダル）
- 生徒との紐付け（モーダル）
  - 同じ学年の生徒一覧を表示
  - 選択して紐付け
  - 紐付け時に申込状況も自動更新（`linked_application_item_id`が設定されている場合）

### 6. 申込状況との連携

#### フォーム作成時
- フォーム編集画面で「申込状況項目と紐付ける」プルダウンを表示
- `application_items`から選択可能
- 選択した項目IDを`forms.linked_application_item_id`に保存

#### 回答紐付け時
- 回答を生徒に紐付ける際、`forms.linked_application_item_id`が設定されている場合
- `student_applications`テーブルに`status = 'completed'`で自動登録/更新

#### 申込状況ページでの表示
- フォームと紐付けられた回答がある場合、該当項目のセルに「1」または「✓」を表示

## API関数

### テンプレート関連
- `getFormTemplates(schoolId?)`: テンプレート一覧取得
- `getFormTemplate(id)`: テンプレート詳細取得
- `createFormTemplate(template)`: テンプレート作成
- `updateFormTemplate(id, template)`: テンプレート更新
- `deleteFormTemplate(id)`: テンプレート削除
- `createFormTemplateField(templateId, field)`: 項目追加
- `updateFormTemplateField(id, field)`: 項目更新
- `deleteFormTemplateField(id)`: 項目削除
- `reorderFormTemplateFields(templateId, fieldIds)`: 項目並び替え

### フォーム関連
- `getForms(schoolId?)`: フォーム一覧取得
- `getForm(id)`: フォーム詳細取得
- `createFormFromTemplate(templateId, formData)`: テンプレートからフォーム作成
- `createForm(formData)`: フォーム作成
- `updateForm(id, formData)`: フォーム更新
- `deleteForm(id)`: フォーム削除
- `updateFormStatus(id, status)`: 状態更新
- `createFormField(formId, field)`: 項目追加
- `updateFormField(id, field)`: 項目更新
- `deleteFormField(id)`: 項目削除
- `reorderFormFields(formId, fieldIds)`: 項目並び替え
- `getPublishedForms(schoolCode)`: 公開中フォーム一覧取得（ポータル用）
- `getFormBySlug(schoolCode, slug)`: スラッグでフォーム取得（ポータル用）

### 回答関連
- `submitFormResponse(formId, response)`: 回答送信
- `getFormResponses(formId, filters?)`: 回答一覧取得
- `getFormResponse(id)`: 回答詳細取得
- `linkResponseToStudent(responseId, studentId)`: 回答と生徒を紐付け
- `unlinkResponseFromStudent(responseId)`: 紐付け解除

## 画面フロー

### 管理者フロー
1. `/forms/manage` → テンプレート/フォーム一覧
2. テンプレート作成 → 項目追加 → フォーム作成
3. フォーム編集 → 公開設定 → リンク取得
4. 回答一覧 → 回答詳細 → 生徒紐付け

### 保護者フロー
1. `/portal/[schoolCode]` → フォーム一覧
2. フォーム選択 → `/portal/[schoolCode]/[formSlug]`
3. フォーム入力 → 送信
4. 完了画面 → ポータルに戻る

## プレビュー機能

**URL**: `/forms/preview/[formId]`

- 管理者がフォームの見た目を確認
- 送信は無効化（`isReadOnly`モード）
- プレビューモードの警告を表示

## 技術実装

### コンポーネント構成
- `TemplateList`: テンプレート一覧
- `TemplateEditor`: テンプレート編集
- `FormList`: フォーム一覧
- `FormEditor`: フォーム編集
- `FieldEditor`: 項目編集（モーダル）
- `PublicFormList`: ポータル用フォーム一覧
- `PublicFormRenderer`: 汎用フォーム表示
- `KomaFormRenderer`: 増コマフォーム専用表示
- `ResponseList`: 回答一覧
- `ResponseDetailModal`: 回答詳細モーダル
- `LinkStudentModal`: 生徒紐付けモーダル
- `FormLinkModal`: リンク取得モーダル

### ユーティリティ
- `src/lib/forms/slots.ts`: スロット生成ロジック
- `src/lib/forms/pricing.ts`: 価格定数
- `src/lib/forms/grade-converter.ts`: 学年変換ロジック

## セキュリティ・アクセス制御

### 現状
- 認証・RLSは未実装
- `school_id`でデータを分離
- 公開フォームは`status = 'published'`かつ公開期間内のみアクセス可能

### 将来の拡張
- 認証機能追加
- RLS（Row Level Security）有効化
- 保護者向けログイン機能

## 制約事項

1. フォームのスラッグは教室内でユニーク
2. 回答の学年は1-13の範囲
3. 増コマフォームは`slug = 'test-koma'`で特別処理
4. チェックボックスの回答は配列形式
5. 数値フィールドの`options`は`min/max/step`形式

## 今後の拡張予定

- メール通知機能
- 回答のエクスポート（CSV）
- フォームの複製機能
- 条件分岐ロジック
- ファイルアップロード機能
