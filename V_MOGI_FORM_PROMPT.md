# Cursor向けプロンプト：Vもぎ申込フォーム実装（既存実装の補完）

## 概要

Vもぎ（都立高校入試模擬試験）の申込フォームは既に基本的な実装が完了しています。このプロンプトは、既存の実装を活かしつつ、不足している機能を補完するためのものです。

---

## 既存実装状況

### ✅ 実装済み

1. **保護者向けフォーム** (`/portal/[schoolCode]/mogi`)
   - 基本情報入力（生徒名、学年、メールアドレス）
   - 日程・会場選択UI（`DateVenueSelector`コンポーネント）
   - キャンセル不可確認（`CancelAgreement`コンポーネント）
   - フォーム送信機能

2. **管理者向け期間設定** (`/settings/forms/mogi`)
   - 期間一覧表示
   - 期間作成・編集モーダル（基本情報のみ）
   - 公開期間の自動計算

3. **回答一覧** (`/forms/responses/mogi/[periodKey]`)
   - 集計表示（`MogiStats`コンポーネント）
   - フィルター機能（学年、日程、会場、計上状態、紐付け状態）
   - 回答一覧テーブル表示

4. **API関数** (`src/lib/api/mogi.ts`)
   - 期間管理（取得、作成、更新、コピー）
   - 回答送信
   - 回答一覧取得
   - 集計データ取得

### ❌ 未実装・改善が必要

1. **期間設定画面**
   - 日程・会場設定UI（`MogiPeriodEditor`に追加が必要）
   - 対象学年設定UI
   - 説明文・完了メッセージ設定UI
   - 申込状況項目との紐付け設定UI
   - 期間削除機能
   - 回答数の表示

2. **回答一覧画面**
   - 計上チェックボックスの機能実装（現在は`alert`のみ）
   - 生徒紐付け機能の実装（現在は`alert`のみ）
   - 回答詳細モーダル
   - 申込状況との自動連携

3. **その他**
   - 期間設定画面のステータス表示を増コマ申込と統一（公開中/公開前/公開終了/未設定）
   - 回答一覧へのリンク機能

---

## 実装すべき機能

### 1. 期間設定画面の日程・会場設定UI

**ファイル**: `src/components/forms/mogi/MogiPeriodEditor.tsx`

**追加すべき機能**:
- 対象学年の選択（チェックボックス、デフォルト: 中3）
- 説明文の入力（テキストエリア）
- 日程・会場の追加・編集・削除UI
- 完了メッセージの入力（テキストエリア）
- 申込状況項目との紐付け選択（プルダウン）

**UI仕様**:
```
┌─────────────────────────────────────────┐
│  対象学年 *                              │
│  ☑ 中3                                  │
│                                         │
│  説明文                                 │
│  ┌─────────────────────────────────┐   │
│  │ Vもぎのお申し込みです。         │   │
│  │ 受験料：4,400円（税込）         │   │
│  └─────────────────────────────────┘   │
│                                         │
│  日程・会場設定 *                        │
│  [+ 日程を追加]                         │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ 日程1                      [削除]│   │
│  │ 日付: [2024-10-06]              │   │
│  │ ラベル: [10月6日（日）]         │   │
│  │ 会場:                           │   │
│  │   [本会場（八王子）] [削除]     │   │
│  │   [塾内受験] [削除]             │   │
│  │   [+ 会場を追加]                │   │
│  └─────────────────────────────────┘   │
│                                         │
│  完了メッセージ                         │
│  ┌─────────────────────────────────┐   │
│  │ お申し込みありがとうございます。 │   │
│  └─────────────────────────────────┘   │
│                                         │
│  申込状況項目との紐付け                 │
│  ┌─────────────────────────────────┐   │
│  │ 選択してください             ▼ │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

**実装のポイント**:
- 日程追加時は日付入力とラベル入力の2つのフィールド
- 会場追加時は会場IDとラベルの2つのフィールド
- 削除ボタンで日程・会場を削除
- バリデーション: 最低1つの日程、各日程に最低1つの会場

### 2. 回答一覧画面の機能実装

**ファイル**: `src/app/forms/responses/mogi/[periodKey]/page.tsx`

**追加すべき機能**:

#### 2-1. 計上チェックボックスの機能実装

```typescript
// 計上状態の更新
const handleChargedToggle = async (responseId: string, charged: boolean) => {
  try {
    await updateMogiChargedStatus(responseId, charged);
    await fetchData(); // データを再取得
    success(`${charged ? '計上' : '計上解除'}しました`);
  } catch (err) {
    error(err instanceof Error ? err.message : '計上状態の更新に失敗しました');
  }
};
```

**API関数の追加** (`src/lib/api/mogi.ts`):
```typescript
export async function updateMogiChargedStatus(
  responseId: string,
  charged: boolean
): Promise<void> {
  await updateFormResponseStatus(responseId, { charged });
}
```

#### 2-2. 生徒紐付け機能の実装

増コマ申込フォーム（`src/app/forms/responses/zoukoma/[periodKey]/page.tsx`）の実装を参考に実装：

- `LinkStudentModal`コンポーネントを使用
- 同じ学年の生徒一覧を表示
- 紐付け時に申込状況を自動更新（`linked_application_item_id`が設定されている場合）

#### 2-3. 回答詳細モーダル

**新規ファイル**: `src/components/forms/mogi/MogiResponseDetailModal.tsx`

**表示内容**:
- 回答日時
- 生徒名、学年、メールアドレス
- 選択した日程・会場一覧（表形式）
- 備考
- 計上状態
- 紐付け状態（紐付け済みの場合は生徒名を表示）

### 3. 期間設定画面の改善

**ファイル**: `src/app/settings/forms/mogi/page.tsx`

#### 3-1. ステータス表示の統一

増コマ申込設定ページ（`src/app/settings/forms/zoukoma/page.tsx`）の`getPeriodStatus`関数を参考に実装：

```typescript
const getPeriodStatus = (period: MogiPeriod) => {
  const now = new Date();
  const start = period.publish_start ? new Date(period.publish_start) : null;
  const end = period.publish_end ? new Date(period.publish_end) : null;

  if (!start || !end) {
    return { label: '未設定', color: 'gray' };
  }
  if (start > now) {
    return { label: '公開前', color: 'yellow' };
  }
  if (end < now) {
    return { label: '公開終了', color: 'gray' };
  }
  return { label: '公開中', color: 'green' };
};
```

#### 3-2. 回答数の表示

**API関数の追加** (`src/lib/api/mogi.ts`):
```typescript
export async function getMogiResponseCount(
  schoolId: string,
  periodKey: string
): Promise<number> {
  const responses = await getMogiResponses(schoolId, periodKey);
  return responses.length;
}
```

期間一覧で各期間の回答数を表示。

#### 3-3. 回答一覧へのリンク

「回答一覧」ボタンに`Link`コンポーネントを使用してリンクを設定：

```typescript
<Link
  href={`/forms/responses/mogi/${period.period_key}`}
  className="text-sm text-[#2a2a2a] hover:text-[#0d0d0d]"
>
  回答一覧
</Link>
```

#### 3-4. 期間削除機能

増コマ申込設定ページの削除機能を参考に実装：

```typescript
const handleDelete = async (periodId: string, periodTitle: string) => {
  if (window.confirm(`「${periodTitle}」を削除してもよろしいですか？`)) {
    try {
      setIsLoading(true);
      await deleteMogiPeriod(periodId);
      await fetchPeriods();
      success('期間を削除しました');
    } catch (error) {
      error(error instanceof Error ? error.message : '期間の削除に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }
};
```

**API関数の追加** (`src/lib/api/mogi.ts`):
```typescript
export async function deleteMogiPeriod(id: string): Promise<void> {
  await deleteFormPeriod(id);
}
```

### 4. DateVenueSelectorコンポーネントの修正

**ファイル**: `src/components/forms/mogi/DateVenueSelector.tsx`

`Select`コンポーネントの使用を修正（`options`プロップを渡す）：

```typescript
<Select
  value={selectedVenueId}
  onChange={(e) => handleVenueChange(date.id, e.target.value)}
  options={[
    { value: '', label: '選択してください' },
    ...date.venues.map((venue) => ({ value: venue.id, label: venue.label }))
  ]}
  disabled={disabled}
/>
```

---

## 実装の優先順位

### 高優先度
1. ✅ `DateVenueSelector`の`Select`コンポーネント修正（既に修正済み）
2. 期間設定画面の日程・会場設定UI
3. 回答一覧の計上チェック機能
4. 回答一覧の生徒紐付け機能

### 中優先度
5. 回答詳細モーダル
6. 期間削除機能
7. 回答数の表示
8. ステータス表示の統一

### 低優先度
9. 回答一覧へのリンク（既にボタンはあるが、リンクが未設定）

---

## 既存コンポーネントの活用

以下の既存コンポーネントを活用してください：

- `ToastContainer`, `useToast` - 通知表示
- `Modal` - モーダル表示
- `Input`, `Select`, `Button` - フォーム要素
- `LinkStudentModal` - 生徒紐付けモーダル（増コマ申込から流用可能）
- `AppHeader` - ページヘッダー

---

## 参考実装

以下のファイルを参考にしてください：

- **期間設定**: `src/app/settings/forms/zoukoma/page.tsx`
- **期間エディタ**: `src/components/forms/zoukoma/ZoukomaPeriodForm.tsx`
- **回答一覧**: `src/app/forms/responses/zoukoma/[periodKey]/page.tsx`
- **API実装**: `src/lib/api/zoukoma.ts`

---

## 注意事項

1. **既存コードの保持**: 既存の実装を削除せず、機能を追加・改善する形で実装してください
2. **型安全性**: TypeScriptの型定義を厳密に守ってください
3. **エラーハンドリング**: すべてのAPI呼び出しでエラーハンドリングを実装してください
4. **UI統一**: 増コマ申込フォームとUI/UXを統一してください
5. **レスポンシブ**: スマホ・タブレット・デスクトップすべてで動作するようにしてください

---

このプロンプトに基づいて、既存実装を活かしつつ不足している機能を補完してください。
