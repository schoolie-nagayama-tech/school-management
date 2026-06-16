# 生徒管理ページ 上部セクション パフォーマンス改善計画

最終更新: 2026-06-16 / 担当: takahashi + Claude

## 0. 背景・ゴール

生徒管理ページ（`src/app/students/page.tsx`）上部のタスク・アラート系ボードの読み込みが遅い。
体感の高速化が目的。スコープは「フル再設計」だが、実測に基づき段階的に進める。

対象ボード（上から）:
- QuickLinksBar / TaskProgressWidget（業務進捗＋講習進捗, 教室長以上）/ BulletinBoard / AlertBoard（Light+Heavy）/ NotificationFeed

---

## 1. 実測結果（2026-06-16, ログイン済み・実データ・4教室）

計測方法: dev サーバー（`next dev`）でログイン済みの `/students` をリロードし、ブラウザの
Performance Resource Timing API で全リクエストの開始・終了・本数を集計。
※ dev のため絶対値は本番より遅い。**注目すべきは「本数」と「直列/並列の形（=構造）」**で、これは本番でも不変。

### 1.1 サマリ
- **データリクエスト 107 本**（Supabase REST 99 + Next API 8）。最後の完了まで **約24秒**。
- HTML/JSシェルは速い（`load` 916ms）。**遅延は全てハイドレーション後のデータ取得**。
- dev の React StrictMode で**全リクエストが2回ずつ**発火（本番では約半分の ~50本）。

### 1.2 突出した重さ
| リクエスト | 所要 | 件数 | 出所 |
|---|---|---|---|
| `/api/courses/prep?action=batch_get` | **各 ~17秒** | 4（教室別） | TaskProgressWidget 講習進捗 |
| `/api/tasks?action=get_progress_widget` | ~12.8秒 | 1 | TaskProgressWidget 業務進捗 |
| `/api/quick-links` | 4.4秒 ＋ **16秒** | **2回（二重呼び）** | QuickLinksBar |
| Heavy アラート連鎖 | 6〜24秒 | 多数 | assessments→student_textbooks→student_textbook_exams→**assessment_scores を assessment_id ごとに細切れチャンクで直列** |

### 1.3 根本原因の診断: 「リクエスト殺到」による接続プール飽和
- 序盤（start≈1500ms）のリクエストは速い（100〜400ms）。
- 後半（start>6000ms）は **自明なテーブルでも 4〜8秒**（例: `subjects` 6.6秒, `students` 6.2秒）。
- → 個別クエリが重いのではなく、**約100本のDBリクエストをハイドレーション直後に一斉発火し、
  Supabase の接続プール/PgBouncer が飽和して全部がキュー待ち**になっている。
- `/api/courses/prep`（4本・各複数ページングクエリ）と `/api/tasks` がサービスロール接続を多数占有し、
  殺到の主要な「加害者」かつ「被害者」になっている。

`batch_get` ハンドラ自体（`src/app/api/courses/prep/route.ts:375`）は各ターゲットを並列実行しており、
個別クエリは妥当（ページング・JOIN済み）。**問題は単体クエリではなく同時発火数**。

---

## 2. 既に対応済み（push 済み）
- `perf(bulletin)` c1cd0ca: 掲示板取得の N+1 を解消。教室ごとの「投稿→自分の既読→講師IDリスト→講師既読数」
  直列＋`getUnreadCount` 別クエリを、`school_id IN` の固定本数（M=5 で約36→9）に削減。
  `getBulletinPostsBatch` / `getBulletinLabelsBatch` を追加。
- `perf(notifications)` cf79fa1: 通知フィードの教室名取得を `getSchool` 個別取得 →
  ロード済み `MasterDataContext` から `useMemo` 導出に。2段目ラウンドトリップを撤去。

> 注: クライアント N+1 修正は有効だが、実測上の支配項は「殺到」と「激遅APIルート」であり、別軸。

### 検証で判明（当初レポートの訂正）
- `batchFetchCoursePrepApi` は **既に30秒TTLキャッシュ＋inflight dedup 実装済み**（`coursePrepApi.ts:70`）。
  → 「キャッシュ無し」は誤り。ただし**初回ロードでは依然 17秒**を払う（殺到の主因）。
- AlertBoard Light（ブロッキング）は**既に7並列**で最適。Heavy の coursePrep ウォーターフォールは
  背景・15秒キャッシュのため体感寄与ほぼゼロ。

---

## 3. 改善計画（実測に基づく優先順位）

### Phase 1: 殺到を止める（最重要・体感最大）
**狙い**: クリティカル描画（Lightアラート・通知・掲示板）を即出しし、重い・低優先の取得を後ろへ。

- [x] **P1-a 講習進捗ウィジェットの遅延ロード**（実装済・未push）: TaskProgressWidget の講習進捗
  （`/api/courses/prep` 4本）を `requestIdleCallback`（fallback setTimeout 1500ms）でアイドル後に取得。
  - dev 実測で course-prep の開始が **1.7秒→6.0秒に後退**（初期殺到の窓0〜3秒から外れた）を確認。
  - UXトレードオフ: 講習進捗の表示が一段遅れる（教室長以上のみ）。ユーザー許容済み。
- [x] **P1-b Heavy アラートの遅延**（実装済・未push）: `getAlertsHeavy` の発火を
  `requestIdleCallback`（fallback 1200ms）でアイドル後に。`heavyRunRef` トークンで
  教室切替時の陳腐化マージを防止。
- [x] **P1-c quick-links 二重呼び**: **対応不要と判明**。原因は dev の React StrictMode による
  effect 二重実行（`cancelled` ガードでも fetch は1回飛ぶ）。**本番では StrictMode は effect を
  二重実行しないため1回**。`QuickLinksBar` の useEffect は `[authLoading, profile?.id]` 依存で正しい。

> dev 計測の「107本・各16〜17秒」は StrictMode 倍化＋非minify＋単一マシンのノイズで大きく水増し。
> **正確な before/after は本番ビルド（`npm run build && npm start`）で計測**すること（StrictMode 倍化なし＝約50本）。

### Phase 2: ピーク同時実行数を下げる（← 実測で定義が変わった）
**決定的な実測（本番ビルド, 2026-06-16）**:
- 本番は dev の約4倍水増しが取れて **総64リクエスト / クリティカル約6.9秒 / 全体約13秒**（dev は107/25秒）。
- `/api/courses/prep` を**他に何も走っていない状態で単発実行すると 271ms**（以降キャッシュで12ms）。
  殺到時は **9149ms** ＝ **同一ルートが約34倍に膨張**。データ量も小さい（最重校で生徒49・パターン98）。
- → **個別ルートは速い。9秒は純粋に接続プーラーの競合**。`fetchSubjectProposals` 等の最適化は無意味。
  **直すべきは「ハイドレ直後の同時リクエスト数」**。

- [x] **P2-a 重い取得をクリティカル後に直列化**（実装済・未push）: `requestIdleCallback`（本番は ~1.9秒で
  早発火し効果薄）を廃止し、`src/lib/utils/networkIdle.ts#whenNetworkIdle()` に置換。
  `PerformanceObserver('resource')` で fetch/xhr が quietMs(700ms) 途絶える＝クリティカルの群れが
  捌けたと判定してから、講習進捗（TaskProgressWidget）と Heavyアラート（AlertBoard）を開始。
  コンポーネント間配線なしの自己完結。安全弁 maxWaitMs(8s)。
  - **検証の限界（正直な記録）**: 機構は機能（course-prep 開始が 1.9秒→2.6〜6.2秒に後退）。
    だが**クリティカル描画完了の短縮は数値で確認できず**。本番ビルド全校で criticalSettle を
    3回測ると **3024 / 8966 / 6539ms（平均~6.2秒）**、旧版は 6867ms(1回)。
    共有の本番DB(シンガポール)を単一マシンから叩く環境では**実行間ノイズ(3〜9秒)が効果より大きい**。
    → この変更は低リスク・機構的に正しい（最悪でも中立）が、定量的な勝ちは主張できない。
    確実に効くのは「リクエスト本数そのものを減らす」P2-b/c の方。
- [ ] **P2-b courses/prep の複数校統合**（任意）: 教室別4本 → `schoolIds` 1リクエスト。
  HTTP往復・getApiAuth の認証3往復（getUser+profile+schools）・サービスロール接続を群れから外す。
  ※ ただし P2-a で群れから分離できていれば優先度は下がる。効果を測って判断。
- [ ] **P2-c 重複クエリの集約**（任意）: Light/Heavy で `getStudents`・`alert_settings`・`alert_dismissals`
  を二重取得。Light の結果を Heavy に渡して再取得を回避。

> 補足: 本番DBは **ap-southeast-1（シンガポール）**。ローカルJP→SG で1往復~70-100ms。
> getApiAuth は API リクエストごとに getUser→profile→schools の約3往復を払う（全 API ルート共通）。

### Phase 3: 構造の作り直し（フル再設計の本丸）
**前提制約の発見**: `selectedSchoolId` は localStorage 保存（AuthContext）でサーバーから読めない。
また app 配下に Server Component でのデータ事前取得パターンは皆無、React Query も未導入＝どちらも新規導入。
`students/page.tsx` は1203行の `'use client'`。→ P3-a は最重要ページの大改造でリスク高、段階的に進める。

- [x] **P3-a 土台: 教室選択を cookie にミラー**（実装済・push済 6ba974c）: AuthContext に
  `selectedSchoolId` を監視する useEffect を追加し、選択を cookie に同期（localStorage は正典のまま）。
  Server Component が初期描画時に現在の選択を読めるようにする土台。cookie 値は信頼せず、
  サーバー側利用者は必ずユーザーの実アクセス権で検証すること。dev で一致・追従を確認済。
- [ ] **P3-a 本体: Server Component 化＋ストリーミング**（未着手・次セッション判断）:
  薄い Server Component で critical 3ボードの初期データを cookie の選択校分だけ事前取得し、
  `initialData` として各ボードへ渡す（boards は initialData があれば初回 client fetch をスキップ）。
  ハイドレーション後にしか fetch が始まらない現状を解消。最重要ページの分割を伴うため高リスク・多段階。
- [ ] **P3-b or React Query 共有キャッシュ**（代替案）: first-load の本質は解決せず、主に再訪・遷移を高速化。
  - P3-a 本体 と P3-b は二者択一。土台(cookie)出荷済みなので P3-a 本体に進める状態。

---

## 4. 検証方法（各 Phase 後に再計測）
- dev で `/students` をリロードし、本ドキュメント 1章と同じ Resource Timing 集計を実行。
- 指標: (1) データリクエスト総数、(2) 最終リクエスト完了時刻、(3) critical 3ボード
  （Lightアラート・通知・掲示板）が描画し切る時刻、(4) 後半リクエストの肥大が消えるか。
- 可能なら本番ビルド（`npm run build && npm start`）でも確認（StrictMode 倍化・dev コンパイルを排除）。

---

## 5. 未決事項・トレードオフ
- P1 の遅延ロードは「重い情報が一段遅れて出る」UX 変化を伴う。教室長以上のみ対象なので許容範囲か要合意。
- quick-links 二重呼びが本番でも起きているか（StrictMode 由来でないか）を実測で切り分け要。
- Phase 3 は二者択一。Phase 1-2 で十分なら着手しない判断もあり得る。
