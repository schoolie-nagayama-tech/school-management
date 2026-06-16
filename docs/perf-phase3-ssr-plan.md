# Phase 3: Server Component 化による初期表示高速化 — 仕様 & 実装計画

最終更新: 2026-06-16 / 担当: takahashi + Claude
関連: [docs/perf-students-top-section-plan.md](./perf-students-top-section-plan.md)（Phase 1-2 と実測）
目標納期: 2026年7月リリース前

> このドキュメントは、コンテキスト圧縮をまたいで Phase 3 を実装するための自己完結メモ。
> 調査・設計・現状の作業ツリー状態・実装手順・検証方法・未決事項を全部ここに集約する。

---

## 0. ゴールと、なぜ Phase 3 が「本丸」か

生徒管理ページ上部（アラート/通知/掲示板/進捗）の初期表示を速くする。

- Phase 1-2（出荷済み）でリクエスト本数削減＋重い取得の後回しをやり、ユーザーは体感改善を確認済み。
- 現状の根本構造: **「ページを開く → JSバンドルDL → hydrate → 各ボードがクライアントで fetch」** という直列。
  さらに各ボードは **クライアントの AuthContext（profile/getSelectedSchoolIds）が確定するまで本取得を始められない**。
- Phase 3 = **サーバー側で認証もデータも先に解決し、最初のHTMLに載せて返す**。これが効けば first-load が根本的に速くなり、
  **生徒管理ページに限らず全ページに効く**（横展開の本命）。

---

## 1. 実測で確定済みの前提（Phase 1-2 から）

- 根本原因は個別クエリの遅さではなく、**ハイドレ直後の同時リクエスト殺到による Supabase 接続プーラー飽和**。
  単発なら 271ms で返る API が、殺到時は 9 秒に膨張（34倍）。本番実態は総64リクエスト/クリティカル約6.9秒/全体約13秒。
  dev の「25秒」は StrictMode 倍化等のアーティファクト。
- 本番DBは **ap-southeast-1（シンガポール）**。ローカル/サーバー(日本)→SG で1往復 ~70-100ms。
- `getApiAuth` は API リクエストごとに getUser→user_profiles→schools の約3往復を払う（全 API ルート共通の隠れコスト）。

---

## 2. Phase 3 の核心的発見（今回のデバッグで判明）

bulletin を最小実験台に SSR 事前取得を試して、2つの事実が判明:

### 2-1. 【修正済み】サーバーがセッションを読めていなかった（潜在バグ）
- ブラウザ用クライアント(`src/lib/supabase.ts`)は `auth.storageKey: 'sb-auth-token'` 指定で、
  セッション cookie は **`sb-auth-token.0` / `sb-auth-token.1`**（チャンク分割）という名前。
- 共有サーバークライアント `createSupabaseServerClient`(`src/lib/supabase-server.ts`)は cookie 名を
  指定しておらず、@supabase/ssr 0.8.0 の `createServerClient` は cookie 名を **`cookieOptions.name`** から決める
  （`auth.storageKey` ではない！両者で API が非対称）。そのため別名 cookie を探して **getUser が常に no user**。
- **→ `createSupabaseServerClient` に `cookieOptions: { name: 'sb-auth-token' }` を追加して修正。**
  これで `getUser()` が通る（検証ログ `user ok` → `OK targets 4 posts 0`）。
- 影響範囲: この共有ヘルパーは **form_periods プレビュー等の「サーバー認証読み取り」全般**で使われており、
  今まで一度もセッションを読めていなかった（authedな下書きプレビュー等が壊れていた可能性）。**実装後に form_periods プレビューの回帰確認をすること。**

### 2-2. 【真の壁】各ボードがクライアント AuthContext に依存して描画する
- `AuthProvider`(`src/contexts/AuthContext.tsx`)はブラウザの Supabase クライアントがセッションを解決した後、
  クライアント側で `fetchProfile` → profile / permissions / schoolIds / demoSchoolIds / selectedSchoolId を順に取得する
  （L89-184）。**初期 state は profile=null, isLoading=true**。
- 各ボードは `useAuth()` から `getSelectedSchoolIds()` / `profile?.role` / `profile?.id` を取り、取得対象校・権限・既読を決める。
- 結果: **サーバーでデータを先取りしても、クライアントで AuthContext が確定するまでボードは本来の描画ができず、
  確定後にもう1回 fetch・再描画する**（SSR の先回りが相殺される）。実測で bulletin は initialData を渡しても
  クライアントで1回 re-fetch していた（auth 確定で getSelectedSchoolIds の identity が変わり useEffect 再実行）。
- `AuthProvider` の `shouldShowLoadingInsteadOfChildren = !isLoading && !user && !public && !invite` は
  **ログアウト時のみ**全画面 Loading（SSR時 isLoading=true なので children は描画される）。なので Loading ゲートは主因ではなく、
  主因は「profile=null のまま部分描画 → クライアント確定後に再描画/再取得」。

**結論: SSR データ事前取得を活かすには、認証も先にサーバーで解決して AuthProvider に初期値として渡し、
クライアントの認証待ちギャップを無くす必要がある。これが Phase 3 の中心。**

---

## 3. 設計: 2本柱

### Pillar A: 認証をサーバーで解決して AuthProvider をシード（★最重要・全ページに効く）
ルートで認証をサーバー解決し、`AuthProvider` の初期 state を埋める。

- `src/app/layout.tsx`（現状クライアント子を直接ラップ）を、**サーバー側で初期認証を解決して AuthProvider に渡す**形にする。
  - サーバーで `createSupabaseServerClient()` → `getUser()` → 成功時に user_profiles(role)・schools or user_schools(schoolIds, demoIds)・
    permissions・cookie の selectedSchoolId を解決し、`initialAuth` オブジェクトにまとめる。
  - これは AuthContext の `fetchProfile`(L89-184) のサーバー版。ロジックを共有/再利用できるよう関数化する。
- `AuthProvider` を改修: `initialAuth?` プロップを受け取り、**あれば初期 state に採用**（profile/permissions/schoolIds/demoSchoolIds/
  selectedSchoolId をセット、`isLoading=false` で開始）。クライアント側の既存フローは**フォールバック/再検証として残す**
  （initialAuth が無い/失効時は従来通りクライアントで解決）。
- 効果:
  - profile が**最初の描画から利用可能** → ボードが正しい権限・対象校で一発描画。
  - `isLoading=false` 開始 → 認証待ちギャップ消滅。**この変更だけで全ページの初期表示が速くなる**（横展開の本命）。
  - `getSelectedSchoolIds()` / schoolIds が初手から安定 → ボードの「auth 確定後の re-fetch」が**起きなくなる**（Pillar B の前提）。
- リスク: AuthProvider はアプリ全体の根幹。**最優先で慎重に。** ハイドレーション不整合(SSR と client state のズレ)に注意。
  initialAuth は「初期値」であり、クライアント側の Supabase セッション監視(`onAuthStateChange` 等)は維持して再検証する。

### Pillar B: 各ボードのサーバー事前取得 + initialData（Pillar A の上で価値が出る）
ページ(students)をサーバーコンポーネント化し、critical 3ボードの初期データを cookie の選択校分だけ事前取得して
`initialData` で渡し、Suspense でストリーミングする。**Pillar A 完了後は auth が初手で安定するので re-fetch が止まり、純粋に速くなる。**

優先度: **bulletin（実装済足場あり）→ notification → alert**。TaskProgressWidget は教室長のみ＋HTTP API 経由で重く、
既に whenNetworkIdle で遅延済みなので **SSR 対象外（クライアント遅延のまま）**でよい。

---

## 4. 各ボードの現状棚卸し（調査結果, 2026-06-16）

| ボード | useAuth 依存 | データ関数の DI 可否 | initialData | profile=null 安全性 |
|---|---|---|---|---|
| **BulletinBoard** | getSelectedSchoolIds, profile.role, profile.id | getBulletinPostsBatch/LabelsBatch=**DI済**, getSchools=未 | **実装済** | 安全（機能のみ無効化） |
| **NotificationFeed** | getSelectedSchoolIds, selectedSchoolId, user.id | getRecentUnprocessedResponses + 直接 supabase.from() 6本=**全て未DI** | 未 | 安全（user=null で既読機能のみ無効） |
| **AlertBoard** | getSelectedSchoolIds, selectedSchoolId, profile.role, profile.id | getAlertsLight/Heavy(`alerts.ts`)=**未DI**, dismissAlert=未 | 未 | ほぼ安全（dismiss は profile.id 必要だが描画は安全） |
| **TaskProgressWidget** | **useAuth 不使用**（schoolIds 等は props 経由） | getProgressWidget/batchFetchCoursePrepApiMulti=HTTP API(getAccessToken 依存) | 未 | N/A（SSR対象外でよい） |

ボードのデータ関数は概ね `import { supabase } from '../supabase'`（ブラウザ用シングルトン）を直接使用。
サーバーで RLS 認証済みクライアントを使うには **関数シグネチャに optional client 引数を足す DI 改修**が必要（bulletin は済）。

---

## 5. 実装手順（順序が重要）

### ステップ 0: 土台の確定（一部済み）
- [x] 教室選択を cookie ミラー（`AuthContext` の useEffect、push済 6ba974c）。
- [x] `createSupabaseServerClient` の `cookieOptions.name: 'sb-auth-token'` 修正（**実装済・未コミット**。form_periods 回帰確認要）。
- [x] BulletinBoard の `initialData` プロップ + 初回 fetch スキップ（**実装済・未コミット**）。
- [x] getBulletinPostsBatch / getBulletinLabelsBatch の client DI（**実装済・未コミット**）。
- [x] `prefetchBulletinInitial`（`src/lib/api/bulletin-server.ts`、**実装済・未コミット**）。
- [x] students ページのサーバー殻/クライアント分割（`page.tsx` server + `StudentsPageClient.tsx`、**実装済・未コミット**）。

### ステップ 1: Pillar A（認証サーバーシード）★ここが本丸・最優先
1. AuthContext の `fetchProfile` 相当を「サーバーでも実行できる純関数」に切り出す
   （入力: server supabase client + userId、出力: { profile, permissions, schoolIds, demoSchoolIds }）。
   クライアント版と共有して二重メンテを避ける。
2. サーバーで `initialAuth` を解決するヘルパー（`src/lib/auth/resolveServerAuth.ts` 等）を作る:
   getUser → 上記純関数 → cookie の selectedSchoolId 解決（'all'/単一/失効時のフォールバックは getSelectedSchoolIds と同規則）。
   失敗時 null（クライアント解決にフォールバック）。
3. `AuthProvider` に `initialAuth?` プロップを追加。あれば初期 state に採用し `isLoading=false` 開始。
   既存のクライアント解決・セッション監視は再検証として維持。
4. `layout.tsx` を調整して initialAuth を AuthProvider に渡す（layout をサーバーで initialAuth 解決 → 渡す）。
   ※ layout は元々サーバーコンポーネント（'use client' 無し）なので async 化しやすい。
5. **検証**: 本番ビルドで、初期 HTML に profile 依存の描画が載るか / 認証待ち Loading が消えるか / 既存ページが壊れないか。
   ハイドレーション警告が出ないこと。複数ロール（admin/manager/teacher）で確認。

### ステップ 2: Pillar B — bulletin で価値を実証
1. ステップ1完了後、bulletin の SSR 事前取得（既に足場あり）が **re-fetch せず**初期表示されることを確認。
2. getSchools も DI 化（または schools は MasterData/initialAuth から渡す）。
3. **本番ビルドで before/after 計測**（リクエスト数＝決定的、クリティカル描画タイミング）。投稿のある教室で確認すること
   （bulletin は実験当時0件で見た目確認不可だった）。

### ステップ 3: Pillar B 展開 — notification, alert
1. `getAlertsLight`(`alerts.ts`) と NotificationFeed の取得群を **DI 改修**（optional client 引数）。
2. それぞれ `prefetch*Initial` サーバーヘルパー + ボードの `initialData` プロップ + 初回スキップ（bulletin と同型）。
3. students の server page で 3ボード分を並列事前取得し、各 Suspense スロットでストリーミング。
4. TaskProgressWidget は SSR 対象外（whenNetworkIdle 遅延のまま）。

### ステップ 4: 仕上げ
- ヘルプページ更新（機能変更時のルール）。re-fetch 抑制の最終確認。横展開（他ページ）の検討メモ。

---

## 6. 現在の作業ツリー状態（コンテキスト圧縮前のスナップショット）

**コミット済み（main, push済）**: cookie ミラー(6ba974c) ＋ Phase1-2 一式 ＋ docs。

**未コミットの作業ツリー変更（Phase 3 足場・デバッグログは除去済み）**:
- `src/lib/supabase-server.ts` — `cookieOptions.name: 'sb-auth-token'` 修正（★これは独立した実バグ修正）
- `src/lib/api/bulletin.ts` — getBulletinPostsBatch/LabelsBatch に client DI 引数
- `src/components/bulletin/BulletinBoard.tsx` — initialData プロップ + 初回スキップ
- `src/lib/api/bulletin-server.ts`（新規）— prefetchBulletinInitial
- `src/app/students/page.tsx` — サーバーコンポーネント化（bulletin を Suspense スロットで事前取得）
- `src/app/students/StudentsPageClient.tsx`（新規）— 旧 page.tsx の全内容 + bulletinSlot プロップ
- `.claude/launch.json` — 本番計測用 `student-management-prod` 設定（任意）

**ハンドオフ方針（要ユーザー判断）**: この足場をコミットして保全するか（mainかブランチか）、いったん巻き戻して
Pillar A から作り直すか。足場は検証済みで安全（graceful fallback・回帰なし）だが、Pillar A 無しでは速くならない。
→ 推奨: **`cookieOptions.name` バグ修正は独立コミット**（form_periods 回帰確認後）。bulletin 足場は WIP として保全。

---

## 7. 検証方法（各ステップ後）
- 本番ビルド（`npm run build` → `student-management-prod` を preview_start）で計測。dev は StrictMode 倍化等でノイズ過大、
  **絶対秒数の A/B は共有本番DB(SG)のブレ(3〜9秒)で埋もれる**ため、**リクエスト本数・SSR HTML に内容が載るか・auth 待ち消滅**
  といった決定的・定性的な指標を主に見る。
- cookie/セッション: ブラウザの `sb-auth-token.0/.1` cookie が前提。教室選択は `selectedSchoolId` cookie（AuthContext がミラー）。
- ロール別（admin/owner/manager/teacher）で権限描画と取得対象校を確認。

## 8. 既知の落とし穴・注意
- @supabase/ssr は **browser=auth.storageKey / server=cookieOptions.name** で cookie 名指定の API が非対称（2-1）。
- データ関数の多くがブラウザ用 `supabase` シングルトンを直接 import。サーバーで使うには DI 改修必須。
- `prefetch*` は最適化。失敗時 null でクライアント取得にフォールバックする設計を厳守（壊れてもページは動く）。
- AuthProvider 改修は全ページ影響。ハイドレーション不整合に最大の注意。
- 本番DBは共有・SG。計測ノイズ大。破壊的操作（既読化/対応済み/タスク完了）は検証で踏まないこと。
