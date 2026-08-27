# 生徒管理システム

学習塾向けの生徒管理システムです。最小構成から始めて、段階的に機能を拡張していく設計になっています。

## 技術スタック

- **フレームワーク**: Next.js 14 (App Router)
- **言語**: TypeScript
- **データベース**: Supabase (PostgreSQL)
- **スタイリング**: Tailwind CSS

## 現在の機能

### v5.3（最新）

- ✅ **通塾日程v2（開始日・変更履歴・担当・比率）** — PR #86 / #87
  - 生徒詳細を通塾日程の登録・変更の本拠地に統合
  - マトリクスに科目をドロップすると、そのまま編集モーダルが開く（担当講師・指導比率・開始日を続けて設定）
  - **版管理**: 「変更日」を指定すると前日までの内容が履歴として残る（過去月の請求計算を守る）。
    変更日が現在の開始日より後なら版を切り、以前なら上書き（純関数 `resolvePatternSaveMode`）
  - **変更履歴・予定**: 終了=グレー / 現在=緑 / 開始前=青のバッジで一覧表示。
    開始前のコマはマトリクスにも薄く表示（`getPatternPeriodStatus`）
  - 座席表の空席「＋」「＋講座の枠」にも授業の開始日を追加（開始日が未来ならその週のコマは作らない）
  - 段階公開: `canUseLessonEntryV2(role, schoolId)`（`src/lib/utils/lessonEntryV2.ts`）で
    座席表の運用を始めた教室から順に開ける。★ロールを先に見てから教室を見る（保護者に職員UIを出さないため）
  - ドラッグ登録が正規の保存処理を通らず時間帯の重複チェックが効いていなかったのを修正（全ロール適用）
  - 旧・入会ウィザード（恒久到達不能だった Step2〜4）を削除（-1,700行）

- ✅ **定員を講座に一本化 ＋「授業の設定」ページ** — PR #77
  - 枠の定員 = 講座の定員（`special_courses.capacity`）優先、無ければ形態の既定値（`resolveClassCapacity`）
  - 旧「コマ時間設定」「授業生徒数設定」「特別講座管理」を `/schedule/special-courses` に統合。
    ① 形態を追加 → ② コマ時間 → ③ 定員 → ④ 講座 → ⑤ 生徒を入れる の流れがそのまま画面の並び
  - 形態タブバーを共有コンポーネント `FormationTabBar` に抽出。旧ルートはリダイレクトで維持

- ✅ **生徒詳細の通塾日程から講座に入れる** — PR #80
  - 講座（HAL・国理社など）も生徒詳細から登録可能に。開催枠固定の講座は曜日・コマ・科目を自動設定
  - 登録は `createFormationClassPatterns` 経由で、定員・重複チェックが座席表の枠登録と完全に同一

- ✅ **座席表の初回描画高速化** — PR #84 / #85
  - 盤面をエントリ取得時点で先に描画（同期チェックの1往復を待たない）
  - ブース番号取得の N+1 を解消（週の表示日数ぶん → 1クエリ。`getBoothNoMapForRange`）
  - 初回描画に不要な取得を後倒し（講習期間・定員・欠勤・全生徒など）。同時リクエスト 約19 → 7
  - `WeeklyScheduleGrid` / `FormationBoard` を `React.memo` 化し、props を安定化。
    盤面に無関係なデータ到着時の再描画を止めてカクつきを解消

- ✅ **個別タブに他形態のコマ・授業が混ざる不具合を修正** — PR #83
  - 個別グリッドに全形態のコマ時間・授業を渡していたため、列が「1・3・4・2・3・4・5限」のように
    混在していた（形態ごとにコマ番号は独立して1から振られる）。個別のみに絞るよう修正

- ✅ **Vercel無料枠超過への対処** — PR #81
  - Speed Insights 削除、共通ナビの `prefetch` 停止（呼び出し回数の主因）、死んだポーリングの削除

- ✅ **モーダルのレイアウト崩れを修正** — PR #87
  - 共通 `Dialog` は「Header(固定) / Content(スクロール) / Footer(固定)」の3段構造が前提。
    Header/Footer を Content の内側に置くとタイトルが切れ保存ボタンが画面外に出る
  - ★同じ組み方のモーダルが他に22箇所ある（別途一括是正の予定）

### v5.2

- ✅ **マスターデータキャッシュ（MasterDataContext）**
  - `schools` と `subjects` をアプリ全体で1回だけ取得し、Context経由でキャッシュ提供
  - 新コンテキスト: `src/contexts/MasterDataContext.tsx`（`useMasterData` フック）
  - `MasterDataProvider` を `layout.tsx` に追加（AuthProvider内側）
  - 15ページの `getSchools()` 直接呼び出しを `useMasterData()` に置換
  - 4ページの `getSubjects()` 直接呼び出しを `useMasterData()` に置換
  - 教室CRUD操作後は `refreshSchools()` でキャッシュを自動更新
  - ログアウト時にキャッシュを自動リセット

- ✅ **スケジュールページのAPI呼び出し最適化**
  - `getRegularPatterns` の重複取得を除去（初期ロードとrefreshEntriesで2回→1回）
  - `regularPatternsRef` でパターンデータを保持し、再取得を回避
  - `getSubjects` を `Promise.all` から除外し、コンテキストキャッシュから取得

### v5.1

- ✅ **アラート表示のスクロール＆コンパクト化**
  - アラート一覧にmax-height+スクロール追加（レスポンシブ対応: 400px/500px）
  - カードヘッダー・アラート行のpadding/font縮小

- ✅ **成績グラフの凡例日本語化＆直線化**
  - Legend・Tooltipの科目名を日本語表示（英語/数学/国語/理科/社会）
  - 折れ線を曲線（monotone）→直線（linear）に変更

- ✅ **換算内申の自動計算機能**
  - 都立（5科×1+実技4科×2＝65点満点）と神奈川（9科合計＝45点満点）に対応
  - 内申テーブルの右端に換算内申列を表示、都立/神奈川トグルで切り替え
  - フロントエンド自動計算（DBに保存しない）
  - ユーティリティ: `src/lib/utils/convertedNaishin.ts`

- ✅ **退会登録フローの改善**
  - 在籍状況の変更を編集画面（StudentForm）に統一
  - 詳細モーダルの在籍状況は読み取り専用バッジ表示
  - ステータス変更時のトースト通知＆フィルター案内

- ✅ **アラート期日3日前表示＆段階色分け**
  - 申込項目の期日3日前からアラートに表示（従来は期限切れのみ）
  - 段階色分け: 3〜2日前（黄）→1日前〜当日（橙）→期限切れ1〜3日（薄赤）→4日以上超過（濃赤）
  - 面談タスクの期日（interview_date）にも `days_until_due` を追加

- ✅ **新着申込一括確認の確認ダイアログ**
  - 一括確認ボタンに `useConfirm` による確認ダイアログを追加
  - 件数を動的にメッセージに含める

- ✅ **タスクフラグ期日設定の改善**
  - 申込項目の編集時にも期日の表示・変更が可能に
  - 期日の更新がDB反映されるよう `updateApplicationItem` に `due_date` を渡す

- ✅ **アップデート情報（リリースノート）**
  - 連絡掲示板内にアップデート情報セクションを組み込み
  - 未読時のみNEWバッジ付きで表示、確認済みで非表示
  - リリースノートデータ: `src/lib/data/releaseNotes.ts`

- ✅ **生徒情報更新履歴ボード**
  - `student_logs` テーブルから直近7日の更新・ステータス変更を表示
  - 変更内容をフィールド名: 旧値→新値の形式で簡易表示
  - 意味のない変更（null→null等）は除外
  - 個別確認/一括確認ボタン、名前クリックで詳細モーダル

- ✅ **模試成績CSVインポート**
  - CSVファイルから模試成績を一括インポート（ドラッグ＆ドロップ対応）
  - テンプレートダウンロード、プレビュー表示、エラー行ハイライト
  - パーサー: `parseMockCSV()` in `csvUtils.ts`
  - モーダル: `MockCsvImportModal.tsx`

- ✅ **HELPページ**
  - アコーディオン形式のFAQ（6カテゴリ）
  - ヘッダーに ?アイコンでリンク
  - 戻るナビゲーション付き

- ✅ **Tiptap SSRエラー修正**
  - RichTextEditorに `immediatelyRender: false` を追加

### v5.0

- ✅ **複数通知メールアドレス対応**
  - `schools.notification_emails TEXT[]` 列を追加
  - 教室設定画面で通知先メールアドレスをリスト管理（追加/削除ボタン）
  - フォーム申込・シーズナルシフト提出の通知を全アドレスに順次送信
  - Resend レート制限（2req/秒）対応：各送信間に1秒の遅延

- ✅ **シーズナルシフト通知の複数アドレス対応**
  - 講師シフト提出時の管理者通知も `notification_emails` 配列で送信

- ✅ **週回数変更・曜日変更フォームの科目表示改善**
  - 45分/90分授業を科目ドロップダウンで判別可能（ラベルに「（45分）」を表示）
  - 小5以上は45分科目を選択不可にするフィルタリング
  - 同名科目の重複によるduration誤判定バグを修正（`"科目名|||duration"` エンコーディングで解決）

- ✅ **科目マスタ追加**
  - 小学生科目12件追加（算数/国語/英語の45分版、算/国・自習・算/理・国/社など複合科目）
  - 高校生科目23件追加（国語・現代文・古典・数学Ⅰ〜Ⅲ・数学A〜C・化学/生物/物理/地学 各基礎版含む など）

- ✅ **増コマ申込 詳細モーダルの実装**
  - 回答一覧の「詳細」ボタンをクリックするとモーダルで詳細表示
  - 表示内容: 基本情報・科目内訳・コマ数・単価・合計金額・希望日程・備考

- ✅ **AppHeader 歯車アイコンの挙動統一**
  - 科目設定モーダルをAppHeader内に移動し、manager以上の全ページで歯車アイコンから利用可能
  - ページ別の設定ラベルを `settingsLabel` prop で差し替え可能

- ✅ **フォーム一覧「現在の公開状況」列の改善**
  - 重複表示（2箇所に同じ期間名）を解消
  - 状態をpill（丸バッジ）＋ボタンの縦2行レイアウトに整理
  - 登録済み件数と期間名を2行目にまとめて表示

- ✅ **新着申込通知ボード（NewResponsesBoard）**
  - 直近7日間の未紐付け申込を生徒管理ページ上部に表示
  - 各申込から回答一覧ページに直リンク

- ✅ **デモ教室フラグ（is_demo）**
  - `schools.is_demo` フラグで教室をデモ/通常に区分
  - 教室切り替えドロップダウンからデモ教室を除外（通常教室がない場合のみ表示）
  - ユーザー管理 学校タブにデモ/通常切り替えボタン

- ✅ **複数教室の申込一覧対応**
  - `getFormResponses` が `schoolId: string | string[]` に対応
  - 複数教室選択時は全教室の申込を並列取得して統合表示

### v4.0

- ✅ **座席表機能**
  - 週次スケジュール表示（`/schedule`）
  - 通塾日程（通常授業パターン）の管理
  - スケジュール一括生成（通塾日程から週次授業を自動作成）
  - 授業の追加・編集・移動・出席・取消・振替
  - 休講日管理・コマ時間マスタ・曜日表示制御
  - 印刷用の日別表示
  - 詳細は後述「座席表のデータ参照」を参照

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

## テスト

```bash
# 開発サーバーを起動した状態で
npm run dev

# 別ターミナルで
npm test
```

⚠️ テストは `npm run dev` でローカルサーバーが起動していないと失敗します。

## 開発用ダミーデータ

- `supabase/seed.dev.sql` — 全テーブルを初期化してダミーデータを投入（本番実行禁止）
- `supabase/seed-additional.dev.sql` — 追加サンプルデータ（既存データは削除しない）

⚠️ これらのファイルは開発環境専用です。本番DBでは絶対に実行しないでください。  
100件以上の生徒データが存在する場合、安全ガードにより実行が中止されます。

## ディレクトリ構成

```
src/
├── app/                    # App Router
│   ├── layout.tsx          # ルートレイアウト
│   ├── page.tsx            # トップページ（/studentsへリダイレクト）
│   ├── globals.css         # グローバルCSS
│   ├── students/           # 生徒管理
│   │   └── page.tsx
│   ├── schedule/           # 座席表
│   │   ├── page.tsx        # 週次座席表
│   │   ├── settings/       # コマ時間・休講日・通塾日程などの設定
│   │   └── regular-patterns/
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
│   ├── students/           # 生徒関連コンポーネント
│   │   └── ...
│   └── schedule/           # 座席表コンポーネント
│       ├── WeeklyScheduleGrid.tsx
│       ├── DayCell.tsx
│       ├── TeacherCard.tsx
│       ├── StudentCard.tsx
│       └── ...
├── contexts/
│   ├── AuthContext.tsx      # 認証コンテキスト（ユーザー・権限・教室選択）
│   └── MasterDataContext.tsx # マスターデータキャッシュ（schools, subjects）
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
│       ├── schedule.ts    # 座席表API関数（コマ時間・休講日・通塾日程・スケジュール）
│       └── attendance.ts   # 出勤簿API関数
└── types/
    ├── database.ts         # 型定義
    ├── schedule.ts         # 座席表型定義（ScheduleEntry, ScheduleTimeSlot など）
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

### 座席表関連テーブル

#### schedule_time_slotsテーブル（コマ時間マスタ）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（外部キー） |
| slot_number | INTEGER | コマ番号（1〜7） |
| start_time | TIME | 開始時刻 |
| end_time | TIME | 終了時刻 |
| is_active | BOOLEAN | 有効フラグ |
| display_order | INTEGER | 表示順 |
| created_at | TIMESTAMPTZ | 作成日時 |
| updated_at | TIMESTAMPTZ | 更新日時 |

**制約**: `UNIQUE(school_id, slot_number)`

#### schedule_closed_daysテーブル（休講日）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（NULL=全教室共通） |
| closed_date | DATE | 休講日 |
| reason | TEXT | 理由（任意） |
| is_global | BOOLEAN | 全教室共通フラグ |
| created_at | TIMESTAMPTZ | 作成日時 |

#### schedule_regular_patternsテーブル（通塾日程・通常授業パターン）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（外部キー） |
| student_id | UUID | 生徒ID（外部キー） |
| day_of_week | SMALLINT | 曜日（0=日〜6=土） |
| time_slot_id | UUID | コマID（外部キー） |
| teacher_id | UUID | 講師ID（user_profiles.id、外部キー） |
| subject_ids | UUID[] | 科目ID配列 |
| seat_label | TEXT | 座席ラベル（任意） |
| period_type | TEXT | 期間タイプ（regular/spring/summer/winter） |
| is_active | BOOLEAN | 有効フラグ |
| created_at | TIMESTAMPTZ | 作成日時 |
| updated_at | TIMESTAMPTZ | 更新日時 |

#### schedule_entriesテーブル（週次スケジュール＝授業）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（外部キー） |
| entry_date | DATE | 授業日 |
| time_slot_id | UUID | コマID（外部キー） |
| teacher_id | UUID | 講師ID（外部キー） |
| student_id | UUID | 生徒ID（外部キー） |
| subject_ids | UUID[] | 科目ID配列 |
| seat_label | TEXT | 座席ラベル（任意） |
| note | TEXT | 備考（任意） |
| regular_pattern_id | UUID | 元の通塾日程ID（生成元、任意） |
| status | TEXT | ステータス（後述） |
| attendance_status | TEXT | 出席状況（present/absent/late、任意） |
| attendance_recorded_at | TIMESTAMPTZ | 出席記録日時 |
| attendance_recorded_by | UUID | 出席記録者ID |
| transfer_from_id | UUID | 振替元エントリID（任意） |
| transfer_to_id | UUID | 振替先エントリID（任意） |
| created_at | TIMESTAMPTZ | 作成日時 |
| updated_at | TIMESTAMPTZ | 更新日時 |

**制約**: `UNIQUE(school_id, entry_date, time_slot_id, teacher_id, student_id)`

**statusの値**:
- `scheduled`: 予定
- `completed`: 出席済
- `cancelled`: 取消
- `transferred_out`: 振替元
- `transferred_in`: 振替先

#### schedule_generation_logsテーブル（スケジュール生成ログ）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | UUID | 主キー |
| school_id | UUID | 教室ID（外部キー） |
| week_start_date | DATE | 週開始日 |
| entries_created | INTEGER | 生成件数 |
| created_by | UUID | 実行者ID（任意） |
| created_at | TIMESTAMPTZ | 作成日時 |

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

## 座席表のデータ参照

座席表（`/schedule`）で表示するデータの取得フローと参照関係をまとめます。

### 概要

座席表は「**日付 × コマ × 講師**」のセル単位で、各セル内に生徒（授業）を表示します。表示されるデータは主に `schedule_entries` から取得し、通塾日程（`schedule_regular_patterns`）から一括生成されます。

### データ取得フロー

```
1. schedule/time-slots, schedule/closed-days, schedule/regular-patterns
2. schedule/entries（週の日付範囲で取得）
3. students, subjects, user_profiles（講師）
```

#### 主要API（`src/lib/api/schedule.ts`）

| 関数 | テーブル | 用途 |
|------|----------|------|
| `getActiveTimeSlots(schoolId)` | schedule_time_slots | 表示するコマ一覧（縦軸） |
| `getClosedDays(schoolId, { from, to })` | schedule_closed_days | 休講日判定 |
| `getRegularPatterns(schoolId)` | schedule_regular_patterns | 通塾日程一覧・スケジュール生成元 |
| `getScheduleEntries(schoolId, fromDate, toDate)` | schedule_entries | 週次授業一覧（表示のメインデータ） |
| `generateWeeklySchedule(schoolId, weekStartDate)` | schedule_regular_patterns + schedule_entries | 通塾日程から週次授業を一括生成 |
| `createScheduleEntry` / `updateScheduleEntry` / `moveScheduleEntry` | schedule_entries | 授業の追加・編集・移動 |
| `recordAttendance` | schedule_entries | 出席記録 |
| `deleteScheduleEntry` | schedule_entries | 授業取消 |
| `createTransferEntry` / `revertTransferEntry` | schedule_entries | 振替の作成・取り消し |

### 表示ロジック（座席表グリッド）

1. **セルのキー**: `(entry_date, time_slot_id)` の組み合わせで、グリッドの1セルを特定

2. **講師グループ**: 同じセル内の `schedule_entries` を `teacher_id` でグルーピング
   - `groupEntriesByTeacher(entries, date, slotId)`（`WeeklyScheduleGrid.tsx`）
   - 各講師ごとに `TeacherCard` が表示され、その中に `StudentCard` が並ぶ

3. **表示対象のエントリ**: `status` が `scheduled`, `completed`, `transferred_in` のもの
   - `cancelled`, `transferred_out` は座席表には表示しない

4. **休講日**: `schedule_closed_days` に登録された日付のセルは「休講日」表示

5. **講師の出勤可否**: `user_profiles` の `available_days_of_week`, `available_slot_numbers_by_day` により、講師追加時に候補を絞り込み

### リレーション（JOIN）の参照先

`getScheduleEntries` は以下のリレーションを取得します。

```
schedule_entries
  ├─ time_slot → schedule_time_slots (*)
  ├─ student   → students (id, last_name, first_name, grade)
  └─ teacher   → user_profiles (id, display_name, email)
```

- **time_slot**: コマの開始・終了時刻、表示順の取得
- **student**: 生徒名・学年の表示
- **teacher**: 講師名の表示

### 通塾日程とスケジュールの関係

| 概念 | テーブル | 役割 |
|------|----------|------|
| 通塾日程 | schedule_regular_patterns | 「毎週○曜日の○限に、生徒Aが講師Bの授業」という定期的パターン |
| 週次スケジュール | schedule_entries | 実際の日付ごとの授業（通塾日程から生成 or 手動追加） |

- **一括生成**: `generateWeeklySchedule` が通塾日程を展開し、指定週の日付ごとに `schedule_entries` を作成
- **regular_pattern_id**: 生成されたエントリは元の通塾日程を `regular_pattern_id` で参照
- **手動追加**: 通塾日程に含まれない授業も `schedule_entries` に直接追加可能

### 関連ファイル

| 種別 | パス |
|------|------|
| ページ | `src/app/schedule/page.tsx` |
| API | `src/lib/api/schedule.ts` |
| 型定義 | `src/types/schedule.ts` |
| コンポーネント | `src/components/schedule/*`（WeeklyScheduleGrid, DayCell, TeacherCard, StudentCard など） |
| マイグレーション | `supabase/migrations/xxx_seat_chart_system.sql`, `xxx_seat_chart_entries_phase2.sql` |

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
- **MasterDataContext**: `schools` と `subjects` をContext経由で全ページ共有キャッシュ（v5.2で導入）
  - ページ遷移時の重複API呼び出しを排除（getSchools: 15回→1回、getSubjects: 4回→1回）
  - `useMasterData()` フックで取得。教室CRUD後は `refreshSchools()` で再取得

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
- 模試申し込み（内部フォーム）
- 面談申し込み（外部リンク）
- Vもぎ申し込み（内部フォーム）
- 週回数変更（内部フォーム）
- 曜日変更申し込み（内部フォーム）
- 教材販売（内部フォーム）
- お客様相談（内部フォーム）

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

## v5.2の設計メモ

### MasterDataContext（マスターデータキャッシュ）

- **課題**: `getSchools()` が15ページ、`getSubjects()` が4ページで毎回Supabaseに個別リクエストしており、ページ遷移のたびに同じデータを再取得していた
- **解決**: `MasterDataContext` を導入し、ログイン後に1回だけ取得してContext経由でキャッシュ提供
- **構成**:
  - `src/contexts/MasterDataContext.tsx` — Provider + `useMasterData()` フック
  - `layout.tsx` で `AuthProvider` の内側に `MasterDataProvider` を配置
- **キャッシュ更新**:
  - 教室の作成/更新/削除時は `refreshSchools()` を呼び出してキャッシュを再取得
  - ログアウト時は `fetchedRef` をリセットし、データをクリア
- **影響ファイル**: 15ページの `getSchools()` + 4ページの `getSubjects()` を `useMasterData()` に置換

### スケジュールページAPI最適化

- **課題**: `getRegularPatterns(schoolId)` が初期ロードの `useEffect` と `refreshEntries` の両方で呼ばれ、同じデータを2回取得していた
- **解決**: `useRef` でパターンデータを保持し、`refreshEntries` では `regularPatternsRef.current` を参照
- `getSubjects()` もコンテキストから取得するよう変更し、`Promise.all` から除外

## v5.0の設計メモ

### 複数通知メールアドレス

- **DBスキーマ**: `schools.notification_emails TEXT[] NOT NULL DEFAULT '{}'`
  - 既存の `notification_email`（単一）はバックワード互換性のため残存
  - 設定保存時は `notification_emails` に加え `notification_email`（先頭アドレス）も同時更新
- **送信ロジック（Edge Function）**: `notification_emails` が空の場合は `notification_email` でフォールバック
- **レート制限対応**: `await delay(1000)` を各送信後に挿入し、Resend の2req/秒制限に対応

### 科目ドロップダウンの duration エンコーディング

- 同名科目（例: 英語90分 と 英語45分）が混在する場合、`subjectDurationMap[name]` の上書き問題が発生していた
- `option.value` を `"科目名|||duration"` 形式でエンコードし、選択時にパースすることで根本解決
- `parseSubjectOptionValue(encoded)` ヘルパーで名前とdurationを分離

### デモ教室フラグ

- マイグレーション: `supabase/migrations/20260312_schools_is_demo.sql`
- DEFAULT 教室は `is_demo=true` で初期化
- `AppHeader` で `displaySchools`（フィルタ済み）と `schools`（全件）を分離し、ドロップダウン表示には前者を使用

### 増コマ詳細モーダル

- 他のフォーム（shukaisu, youbi, moshi など）と同じ `detailResponse` state パターンを踏襲
- `ZoukomaResponseDetailModal` を新規作成し `src/components/forms/zoukoma/index.ts` からエクスポート

---

## 拡張予定

今後追加予定の機能:

- [x] 講師管理（v4.0で実装済み、ユーザー管理に統合）
- [x] 講師出勤簿機能（v4.0で実装済み）
- [x] 授業スケジュール管理（座席表として実装済み）
- [x] 出欠管理（v4.0で座席表の出席記録として実装済み）
- [x] 成績管理（v2.0で実装済み）
- [ ] 請求・入金管理
- [x] 保護者ポータル（v3.0で実装済み）
- [x] 複数教室対応（v1.5で基本実装済み）
- [x] 認証機能（v1.5で設計準備済み、v4.0で実装済み）
- [x] 保護者ポータル内の各フォーム（模試・週回数・曜日・教材・相談 全7種、v3.0〜v5.0で実装済み）
- [x] 複数通知メールアドレス対応（v5.0で実装済み）
- [x] デモ教室フラグ（v5.0で実装済み）
- [x] 換算内申の自動計算（v5.1で実装済み）
- [x] 模試成績CSVインポート（v5.1で実装済み）
- [x] HELPページ（v5.1で実装済み）
- [x] アラート期日3日前表示＆段階色分け（v5.1で実装済み）
- [x] リリースノート機能（v5.1で実装済み）
- [x] 生徒情報更新履歴ボード（v5.1で実装済み）
- [x] マスターデータキャッシュ（v5.2で実装済み — schools/subjectsの全ページ共有キャッシュ）
- [x] スケジュールページAPI最適化（v5.2で実装済み — 重複取得の除去）
- [ ] Googleカレンダー連携（面談予定のカレンダー追加）
- [ ] Slack連携（新着申込・タスク期限・アラート通知）

## ライセンス

Private
