# テスト環境ガイド

## 概要

本プロジェクトのテスト環境は3層構成になっています。

| レイヤー             | ツール                         | 環境  | 対象                                       |
| -------------------- | ------------------------------ | ----- | ------------------------------------------ |
| ユニットテスト       | Vitest                         | node  | ユーティリティ関数、Zodスキーマ、APIルート |
| コンポーネントテスト | Vitest + React Testing Library | jsdom | Reactコンポーネント                        |
| 統合テスト           | Vitest + ローカルSupabase      | node  | DB操作（CRUD）                             |

---

## 1. ユニットテスト & コンポーネントテスト

### 実行方法

```bash
# 全テスト実行
npm test

# ウォッチモード
npm run test:watch

# 特定ファイルのみ
npx vitest run src/__tests__/components/
npx vitest run src/__tests__/api-routes/
```

### 設定ファイル

- `vitest.config.ts` — メイン設定
  - `environment: 'node'`（デフォルト）
  - `environmentMatchGlobs: [['src/__tests__/components/**', 'jsdom']]`
  - `setupFiles: ['./src/__tests__/setup.ts']`（jest-dom マッチャー読み込み）
  - テスト用環境変数（Supabase URL/KEY）を設定
  - 統合テスト（`src/__tests__/integration/**`）は除外

### ディレクトリ構成

```
src/__tests__/
├── setup.ts                    # @testing-library/jest-dom/vitest
├── api-routes/                 # APIルートテスト（Phse 2）
│   ├── helpers.ts              # モックファクトリ（createMockChain, authSuccessMocks等）
│   ├── admin-users.test.ts     # GET /api/admin/users
│   ├── admin-users-create.test.ts  # POST /api/admin/users/create
│   └── portal-form-responses.test.ts  # POST /api/portal/form-responses
├── components/                 # コンポーネントテスト（Phase 3）
│   ├── DeleteConfirmDialog.test.tsx
│   ├── BulletinPostCard.test.tsx
│   └── FieldEditor.test.tsx
├── utils/                      # ユーティリティテスト
│   ├── fifthWeek.test.ts
│   ├── password.test.ts
│   └── period.test.ts
├── validations/
│   └── schemas.test.ts         # Zodスキーマテスト
├── integration/                # 統合テスト（別設定で実行）
│   ├── setup.ts
│   ├── helpers.ts
│   ├── schools.test.ts
│   └── students.test.ts
└── (既存テスト)
    ├── api-auth.test.ts
    ├── convertedNaishin.test.ts
    ├── csvUtils.test.ts
    ├── date.test.ts
    ├── errorMessages.test.ts
    ├── rateLimit.test.ts
    └── validation.test.ts
```

### モックパターン

#### Supabaseクライアント（APIルートテスト）

```ts
import { createMockSupabaseAdmin, createMockChain, authSuccessMocks } from './helpers';

const mockAdmin = createMockSupabaseAdmin();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAdmin),
}));

// クエリチェーン: from().select().eq().single() を模倣
mockAdmin.from.mockImplementation(() => createMockChain(returnData) as never);
```

#### 認証ガード（APIルートテスト）

```ts
// 認証成功
vi.mock('@/lib/api-auth', () => authSuccessMocks());

// 認証失敗
vi.mock('@/lib/api-auth', () => authFailMocks());

// 個別テストで一時的に上書き
const { requireAdmin } = await import('@/lib/api-auth');
vi.mocked(requireAdmin).mockResolvedValueOnce(
  NextResponse.json({ error: '認証が必要です' }, { status: 401 })
);
```

#### コンポーネントテスト

```tsx
// @vitest-environment jsdom  ← ファイル先頭に必須（Windowsのパスマッチング問題回避）
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// DOMPurify のモック
vi.mock('isomorphic-dompurify', () => ({
  default: { sanitize: vi.fn((html: string) => html) },
}));
```

---

## 2. 統合テスト（ローカルSupabase）

### 前提条件

- Docker Desktop が起動していること
- Supabase CLI がインストールされていること（`npm i -g supabase`）
- `.env.test` が設定されていること

### セットアップ

```bash
# ローカルSupabase起動
npm run db:start

# 状態確認
npm run db:status

# スキーマリセット（必要に応じて）
npm run db:reset
```

### .env.test

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<supabase status で確認>
SUPABASE_ANON_KEY=<supabase status で確認>
```

### 実行方法

```bash
npm run test:integration
```

### 設定ファイル

- `vitest.integration.config.ts` — 統合テスト専用設定
  - `include: ['src/__tests__/integration/**/*.test.ts']`
  - `sequence: { concurrent: false }`（テスト間のDB干渉防止）
  - `testTimeout: 15000`

### マイグレーション管理

ローカルDBは本番スキーマダンプをベースに構築しています：

```
supabase/migrations/
├── 00000000000000_base_schema.sql    # 本番DBダンプ（ベース）
└── _archived_for_local_dev/          # 元のマイグレーション（アーカイブ）
    ├── 20260312020000_subjects_duration_minutes.sql
    └── ... (37ファイル)
```

> **本番へのマイグレーション追加時**: `_archived_for_local_dev/` からファイルを戻す必要はありません。
> 新しいマイグレーションは `supabase/migrations/` に通常通り追加してください。
> 詳細は `supabase/LOCAL_DEV.md` を参照。

---

## 3. CI/CD

`.github/workflows/ci.yml` にユニットテスト実行ステップが含まれています：

```yaml
- name: Run tests
  run: npm test
```

統合テストはローカルSupabaseが必要なため、CIでは実行されません。

---

## テスト追加ガイドライン

### 新しいAPIルートテストを追加する場合

1. `src/__tests__/api-routes/` にファイルを作成
2. `helpers.ts` の `createMockChain` / `authSuccessMocks` を使用
3. ルートハンドラを `await import('@/app/api/.../route')` で動的インポート

### 新しいコンポーネントテストを追加する場合

1. `src/__tests__/components/` にファイルを作成
2. ファイル先頭に `@vitest-environment jsdom` コメントを追加
3. `@/components/ui` のコンポーネントはそのまま使用可能（実際のUIコンポーネント）

### 新しい統合テストを追加する場合

1. `src/__tests__/integration/` にファイルを作成
2. `helpers.ts` の `createTestSchool` / `cleanupTestSchool` でテストデータを管理
3. `afterAll` でクリーンアップを必ず実行

---

## パッケージ一覧（テスト関連）

| パッケージ                    | 用途                             |
| ----------------------------- | -------------------------------- |
| `vitest`                      | テストランナー                   |
| `@vitejs/plugin-react`        | JSX変換（コンポーネントテスト）  |
| `@testing-library/react`      | Reactコンポーネントテスト        |
| `@testing-library/jest-dom`   | DOM マッチャー                   |
| `@testing-library/user-event` | ユーザーイベントシミュレーション |
| `jsdom`                       | ブラウザ環境エミュレーション     |
