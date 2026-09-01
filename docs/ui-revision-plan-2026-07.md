# UI改訂計画 2026-07 — 掲示板既読必須化・進行表整理・アラート再構成

作成: 2026-07-07 / ステータス: 計画（未着手）

対象は3領域。互いに独立しており、どの順でも着手できるが、推奨順は **A(掲示板) → C(アラート) → B(進行表)**（Aは仕組みが既にあり最小工数、Bは触る箇所が多くUI合意が要るため最後）。

---

## A. 掲示板の既読必須化（未読ブロッキング表示）

> ステータス: **実装済み（2026-07-07・未デプロイ / migration 未適用）**。tsc 0エラー・dev スモーク確認済み。実データでのゲート発火検証（講師ログイン＋未読）は未実施。
>
> - 追加: [BulletinUnreadContext.tsx](../src/contexts/BulletinUnreadContext.tsx)（未読の一元管理・2段階取得）、[UnreadBulletinGate.tsx](../src/components/bulletin/UnreadBulletinGate.tsx)（全画面ゲート）、[bulletinHtml.ts](../src/lib/utils/bulletinHtml.ts)（サニタイズ共通化）、[bulletin.ts](../src/lib/api/bulletin.ts) の `getUnreadPosts`、migration `20260707_bulletin_reads_backfill.sql`
> - 変更: [layout.tsx](../src/app/layout.tsx)（Provider＋ゲート差し込み）、[AppHeader.tsx](../src/components/layout/AppHeader.tsx)（未読バナーを context 参照に移管・自前ポーリング廃止）、[BulletinPostCard.tsx](../src/components/bulletin/BulletinPostCard.tsx)（サニタイズを共通util化）、help FAQ 追加
> - 設置は計画の AdminLayout ではなく **RootLayout** に変更（全認証ページを単一マウントでカバー・AdminLayout の headerTitle 有無に依存しないため）。
> - **デプロイ前に migration 適用必須**（未適用だと初回ログインで過去投稿が全部ブロック表示される）。

### 目的

講師が掲示板の連絡事項を読まずに業務を進めてしまう。未読の連絡がある場合は掲示板を全画面で表示し、既読を押すまで他の操作をできなくする。

### 現状（調査済み）

- 既読の記録基盤は**実装済み**: `bulletin_reads` テーブル（`UNIQUE(post_id, user_id)`）、`markAsRead()` / `getUnreadCount()`（[bulletin.ts](../src/lib/api/bulletin.ts) L606/L663）、既読者・未読者モーダル。
- 既読操作は**講師ロールのみ**（`BulletinBoard.tsx` の `canRead = role === 'teacher'`）。
- 未読通知は現状 `AppHeader.tsx:503-513` のヘッダー下バナー（amber帯、/students へのリンク）のみ。強制力なし。
- 掲示板本体は `/students` ページにしか描画されない。

### 設計

1. **新コンポーネント `UnreadBulletinGate`**（`src/components/bulletin/`）
   - 全画面オーバーレイ（z-index はモーダル最上位、ESC・背景クリックで閉じない）。
   - 未読投稿をカード形式で列挙（タイトル・ラベル・本文・link_url・投稿日）。各投稿に「既読にする」ボタン。**全件既読で自動的に閉じる**。一括既読ボタンは付けない（読まずに閉じる抜け道になるため）。
   - 既読時に既存のカスタムイベント `bulletin-unread-changed` を発火し、AppHeader のバナーと同期。
2. **差し込み位置**: [AdminLayout.tsx](../src/components/layouts/AdminLayout.tsx) のトップレベル（`AppHeader` と同階層）。管理系ページ全体をカバーし、`useAuth()` の `profile` にそのまま届く。portal 配下は対象外。
3. **対象ロール**: 講師のみ（既読モデルが講師専用のため。教室長以上は投稿側なので対象外）。なりすまし（アカウントスイッチ）中は**ゲートを出す**（「その講師として振る舞う」状態なので講師本人と同じ扱い。教室長が講師体験を確認するときもこの経路。※当初はスキップ実装だったが、テスト・実運用の両面でスキップは不適と判断し 2026-07-07 に撤回）。
4. **未読の定義**: `is_archived = false` の投稿のうち `bulletin_reads` に自分のレコードが無いもの。担当全教室分を対象。
   - **導入時の過去分対策**: リリース時点より前の投稿で全講師分の `bulletin_reads` をバックフィルする migration を用意（さもないと初回ログインで過去の全投稿がブロック表示される）。
   - 投稿の**編集**では既読はリセットしない（v1 の割り切り。必要になったら「再読必須」フラグを後付け）。
5. **取得の共通化**: AppHeader が既に教室ごとに `getUnreadCount` を叩いている。ゲートとバナーで二重fetchしないよう、`useBulletinUnread()` フック（未読件数＋未読投稿リスト）に持ち上げて両者で共有する。
   - パフォーマンス注意: ハイドレ直後のリクエスト殺到問題（perf対策済み領域）を悪化させないこと。未読**件数**はまず既存経路で取り、未読**本文**はゲートを出すと決まってから遅延取得する。

### 影響ファイル

- 新規: `src/components/bulletin/UnreadBulletinGate.tsx`、`src/hooks/useBulletinUnread.ts`（または lib/hooks 配下の既存慣習に合わせる）
- 変更: `AdminLayout.tsx`（ゲート差し込み）、`AppHeader.tsx`（バナーのfetchをフックへ移管）、`bulletin.ts`（未読投稿リスト取得関数 `getUnreadPosts(schoolIds, userId)` を追加）
- migration: 既読バックフィル 1本
- `help/page.tsx` の FAQ_DATA 更新（講師向け「掲示板が全画面で出るのはなぜ？」）

### 確認ポイント（要ユーザー判断）

- ブロック中でも許可する操作はあるか（例: ログアウトは許可すべき）→ ログアウトのみ許可を既定とする。
- 出勤直後の慌ただしい時間帯に長文投稿が複数あると業務開始が遅れる。投稿側に「既読必須にする/しない」のチェックを付けるか（v1では全投稿必須で開始し、運用を見て判断でも可）。

---

## B. 進行表（進捗管理）の改善

> ステータス: **実装済み（2026-07-08・未デプロイ）**。tsc 0エラー・管理者のライブ画面で確認済み（ヘッダー統合／教科書タブ廃止／季節セレクタ／引継ぎ2カラム＋改行整形）。
>
> - 変更: [TableView.tsx](../src/app/students/%5BstudentId%5D/progress/TableView.tsx)（左ヘッダーに一覧遷移＋生徒名＋テキスト名＋季節バッジを集約／教科書タブ削除／テスト対策・講習提案書を`role!=='teacher'`ガード／季節チップの×廃止し設定カードに`なし/春/夏/冬`セレクタ追加(教室長以上)／`seasonCleared`→`seasonOverride`楽観更新／`studentGrade` prop追加）、[NewProgressPage.tsx](../src/app/students/%5BstudentId%5D/progress/NewProgressPage.tsx)（テーブル表示時は生徒名を出さずテーブル側に集約・studentGrade受け渡し）、[LastHandoverCard.tsx](../src/components/progress/LastHandoverCard.tsx)（左メタ・右本文の2カラム＋`formatHandover`で「次回:／確認テスト:」等の前で改行＋本文text-base）、help FAQ 追記
> - テスト対策・講習提案書の講師非表示は**ユーザーが元依頼で明示**（過去コメント「講師も利用」からの転換を確定）。面談モードのヘッダーは現行挙動を維持。
>
> **細部の追調整（2026-07-08 フィードバック反映）**:
>
> - ① 引継ぎカード本文を text-base→text-sm に縮小（目標を主役にするため）。
> - ② 目標パネルを拡大。目標点を text-4xl・extrabold の主役に、残り/結果/行動目標は text-2xl。
> - ③ 申込/提案コマ数のテキスト表示から「コマ」を削除し数字のみ（[ProgressRow.tsx](../src/app/students/%5BstudentId%5D/progress/ProgressRow.tsx)。入力欄は元々数値）。
> - ④ 行罫線を `#f3f4f6`→`#d1d5db` に濃く。入力済み日付を青チップ（[DateInputWithToday.tsx](../src/app/students/%5BstudentId%5D/progress/DateInputWithToday.tsx)）にして、スクロール時に「どこまで実施済みか」を一目で追える。
> - ⑤ 表内の引継ぎメモを `HandoverCell`（ProgressRow内）に刷新: 入力済み・非編集時は全文を折り返して表示（クリックで編集）、編集時は内容量に応じ高さ自動調整。従来の1行テキストエリアの読みづらさを解消。

### 現状（調査済み）

- 本体 [NewProgressPage.tsx](../src/app/students/%5BstudentId%5D/progress/NewProgressPage.tsx)（510行）がパンくず・生徒名・モード/ビュー切替を描画。
- 上部のテキスト名・テキスト切替タブ・ボタン群・季節バッジ・引継ぎカード呼び出しはすべて [TableView.tsx](../src/app/students/%5BstudentId%5D/progress/TableView.tsx)（1353行、L569-736）に内包。次の分割候補ファイルでもある。
- 季節バッジ: `student_textbooks.season`（spring/summer/winter）。付与は講習提案書の公開で自動、解除のみ教室長以上が×ボタンで可能（L757）。
- テスト対策・講習提案書ボタン: ロール制御なし（コメントで「講師も利用する業務のため全ロール表示」と明記 → 今回方針転換。下記確認ポイント参照）。
- 前回の引継ぎ: `LastHandoverCard.tsx`、`progress_sessions` から最新1件。

### B-1. 上部の情報過多解消 ＋ ヘッダー整理

1. **テキスト切替タブを削除**（TableView L591付近のタブ群）。テキストの切替は「←テキスト一覧」からのみ。
2. **ヘッダーを `ProgressHeader.tsx` として新規切り出し**（TableView のスリム化も兼ねる）。構成案:
   - 1行目: パンくず「生徒詳細 › 進捗管理 › テキスト一覧」＋ 右端にモード/ビュー切替（現在 NewProgressPage 側とTableView側に分散している要素を1ブロックに統合）
   - 2行目: **生徒名（大）＋ 学年 ＋ テキスト名（大）＋ 季節バッジ** を1行に。右端にアクション群（公開状態・授業を記録・設定。テスト対策/講習提案書は教室長以上のみ）
3. **季節バッジの付け外しを「設定」へ移動**: `TextbookSettingsInline`（設定パネル）に季節セレクト（なし/春期/夏期/冬期）を追加し、**教室長以上のみ**表示。ヘッダーの×ボタンは廃止。講習提案書公開時の自動付与は現行維持。
4. **テスト対策・講習提案書ボタンを講師に非表示**: `role === 'teacher'` で非表示（TableView L643-658）。

### B-2. 視認性の向上（字の大きさ・色）

情報を3段階に分ける方針で全体を統一:

- **一次情報（大・濃色）**: 生徒名、テキスト名、引継ぎコメント本文、確認テスト指示
- **二次情報（標準）**: 単元名、目標値、進め方/宿題の出し方
- **三次情報（小・グレー）**: 日付、記録者名、パンくず、補足ラベル
  実装はテキストサイズ（text-lg/base/xs）と既存トークンの色階調で行い、新色は導入しない（UI掃き寄せ方針に準拠）。

### B-3. 引継ぎカードの横幅拡大

`LastHandoverCard` を改修:

- 単元チップ列と本文を縦積みにせず、**左に日付・記録者などのメタ（狭い固定幅）、右に本文（全幅・text-base）** の2カラム構成。狭い画面では縦積みにフォールバック。
- 本文が複数の意味単位（宿題/次回/確認テスト）を含むことが多いので、「宿題:」「次回:」「確認テスト:」等の既知プレフィックスで改行して見せる軽い整形を入れる（データは変えず表示のみ）。

### 影響ファイル

- 新規: `ProgressHeader.tsx`
- 変更: `TableView.tsx`（ヘッダー切り出し・タブ削除・ボタンロール制御・×ボタン廃止）、`NewProgressPage.tsx`（ヘッダー統合）、`TextbookSettingsInline.tsx`（季節セレクト）、`LastHandoverCard.tsx`（レイアウト）、`CardsView.tsx`/`TextbookCard.tsx`（バッジ表示の整合確認）
- `help/page.tsx` FAQ_DATA 更新（テキスト切替方法の変更、季節バッジの付け方）

### 確認ポイント（要ユーザー判断）

- テスト対策・講習提案書の講師非表示は、コード上「講師も作成/利用する業務」と明記されていた過去方針の転換。**講師がこれらを起票する運用が現場に残っていないか**だけ要確認（残っている場合は「閲覧のみ許可」等の中間案）。
- 面談モード（isMeeting）でのヘッダー表示は現行踏襲か、面談用にさらに簡素化するか。

---

## C. アラートの再構成（系列グルーピング・重要度差別化）

> ステータス: **実装済み（2026-07-08・未デプロイ）**。tsc 0エラー・集約ロジックのユニットテスト10件パス・なりすまし講師のライブ画面で描画確認済み（チップ/系列セクション/生徒数/マスク/展開行）。
>
> - 追加: [grouping.ts](../src/lib/alerts/grouping.ts)（`resolveSeverity` ＋ `groupAlertsBySeries` 純関数）、テスト `src/__tests__/lib/alertGrouping.test.ts`
> - 変更: [AlertBoard.tsx](../src/components/alerts/AlertBoard.tsx)（系列セクション＋生徒1行に再編・フィルターチップ・severityスタイル・`StudentAlertCard`を`AlertSeriesSectionView`/`AlertSeriesRowView`に置換）、[AlertItem.tsx](../src/components/alerts/AlertItem.tsx)（`hideLabel` 追加）
> - 集約の粒度は「生徒×系列で1行」で確定（AskUserQuestionで合意）。同一生徒×同一系列の複数件は展開行。severity未設定4タイプは`resolveSeverity`が既定＋日数段階を付与（ビルダーは非改変）。danger含む系列を上にソート。マルチ校は「教室›系列」の2段維持。

### 現状（調査済み）

- [AlertBoard.tsx](../src/components/alerts/AlertBoard.tsx) は**生徒ごとに1カード**、カード内に複数 `AlertItem` を縦積み。系列（`alert_type`、全11種）横断のグルーピングは無い。
- `AlertSeverity`（info/warning/danger）は型として存在するが**一部タイプのみ設定**（score_missing / interview_overdue / interview_task / exam_overdue は未設定）。UI上は行の背景色にしか使われず、ソートには未使用。
- 比較対象の [NotificationFeed.tsx](../src/components/notifications/NotificationFeed.tsx) は「時系列1本リスト＋種類別フィルターチップ（件数バッジ付き）」方式。

### 設計

1. **同一系列の集約（1生徒×1系列=1行）**
   - `applyDismissAndSort` の後段に集約ステップを追加: 同じ `student_id` × `alert_type` の複数アラートを1行にまとめ、`occurrence_count` と代表メッセージ（例: 「宿題未実施 3回（直近 7/3）」）で表示。詳細は行の展開（クリックで開閉）で見られるようにする。
2. **系列ごとのグルーピング表示**
   - 生徒カード方式をやめ、**系列（alert_type）ごとのセクション**に再編。セクション見出し＝系列ラベル＋件数。セクション内は生徒1行（集約済み）。
   - 上部に NotificationFeed と同じ**フィルターチップ**（すべて/成績/面談/宿題・遅刻/講習/日程…※近い系列は束ねたチップにする）を置き、絞り込み可能にする。UIパターンは NotificationFeed の `filterChips` 実装を流用。
3. **情報の重さ（severity）の全面適用**
   - 未設定の4タイプ（score_missing / interview_overdue / interview_task / exam_overdue）に severity を定義（既定: interview_task=warning、他は経過日数で info→warning→danger の段階化。しきい値は既存 `AlertThresholds` に揃える）。
   - 表示差別化: danger=左ボーダー濃色＋太字＋セクション先頭、warning=中間、info=薄色・細字。セクションの並び順自体も「dangerを含むセクションが上」。
4. **既存ロール制御の維持**: `SENSITIVE_ALERT_TYPES` / `TEACHER_HIDDEN_ALERT_TYPES` 等の表示制御セットは新レイアウトでもそのまま通す。マルチ校選択時の教室グルーピングは「教室 › 系列」の2段で維持。

### 影響ファイル

- 変更: `AlertBoard.tsx`（レイアウト再編・チップ・集約）、`AlertItem.tsx`（行スタイルの severity 3段階化・展開UI）、`alerts.ts`（未設定タイプへの severity 付与・集約ヘルパー）、`types/alerts.ts`（集約行の型）
- `/home`（`src/app/home/page.tsx`）にも AlertBoard が載っているため両ページで表示確認
- `help/page.tsx` FAQ_DATA 更新

### 確認ポイント（要ユーザー判断）

- 「同じ系列を1行にまとめる」の単位: 本計画は**生徒×系列**で集約（例: 溝口くんの宿題未実施3件→1行）。もし**系列全体で1行**（例: 「宿題未実施 12名」→クリックで展開）まで圧縮したい場合はその旨指示ください。後者の方が情報量は減るが一覧性は粗くなる。

---

## 工程・順序

| フェーズ | 内容                                                                                   | 規模感                   |
| -------- | -------------------------------------------------------------------------------------- | ------------------------ |
| 1        | A: useBulletinUnread フック化 → UnreadBulletinGate → バックフィル migration → FAQ      | 小〜中（基盤既存のため） |
| 2        | C: severity 全面付与 → 集約ロジック（純関数、ユニットテスト可）→ AlertBoard 再編 → FAQ | 中                       |
| 3        | B-1: ProgressHeader 切り出し・タブ削除・ロール制御・季節設定移動                       | 中                       |
| 4        | B-2/B-3: 視認性3段階の適用・引継ぎカード改修 → FAQ                                     | 小〜中                   |

各フェーズ完了ごとに dev で動作確認（serwist SW キャッシュに注意: 検証時は caches.delete + reload）。C の集約ロジックは請求同期テストの前例に倣い純関数に切り出してユニットテストを付ける。
