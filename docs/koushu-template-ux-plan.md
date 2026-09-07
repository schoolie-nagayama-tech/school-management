# 講習テンプレート（講習コース）UX改善計画

作成: 2026-09-04
対象: `/courses`（テンプレ一覧）・`/courses/[courseId]`（テンプレ詳細＝プラン作成）
方針: 一覧は「削って直す」、詳細は「提案書エディタ（ProposalEditor）の部品に置き換える」

---

## 0. 用語の整理（先に潰す混乱）

コード上「テンプレート」と呼べるものが2系統ある。本計画の対象は **A** のみ。

| | 実体 | 画面 | 中身 |
|---|---|---|---|
| **A. 講習コース** | `seasonal_courses` | `/courses`, `/courses/[courseId]` | 教材＋単元＋コマ数の雛形。生徒に適用して提案書を量産する |
| B. 表テンプレ | `course_templates` | `/courses/schedule`, `/courses/progress` | 工程表・進捗表の列定義。`TemplateApplyDialog` はこっち |

`src/components/course-shared/TemplateApplyDialog.tsx` と `courseTemplates.ts` は A と無関係。触らない。

## 1. 本番データが示す現状（2026-09-04 集計）

| 指標 | 値 | 意味 |
|---|---|---|
| 有効コース | 1,265 | 一覧に全部出る |
| うち単元設定ゼロ | 413（33%） | 「作成→詳細で設定」の2段構えで作りっぱなしの空殻 |
| 名前のユニーク数 | 356 | 「全教室に展開」で同名が教室数ぶん複製される |
| 適用実績のあるコース | 152 | 使われたのは12% |
| 冬期・複数テキスト | 52 / 68 | 複数テキストは冬期で現役。モデルから外せない |
| 夏期・1テキスト | 853 | 提案書からの「講習に登録」で量産されたと推測 |

結論:
- 一覧の最大の問題は機能不足ではなく **母数**。空殻と重複が7割を占める。
- 作成フローが「2段構え」なのが空殻の原因。**作成＝エディタで完結** に変える。
- 複数テキストはモデルとして残す（冬期の実態）。UIはテキストごとのタブ。

## 2. 一覧ページの改善項目

工数: S=半日以内 / M=1〜2日 / L=3日以上。UX効果: ◎大 ○中 △小。

### 2-1. 削るもの（シンプル化）

| # | 項目 | 理由 | 工数 | UX |
|---|---|---|---|---|
| D1 | 右端のカスタム縦スクロールバー＋学年ジャンプ（`NAV_GRADES`、L836-871） | 学年フィルタで代替できる。小学生に飛べない不完全実装。インラインstyleの温床 | S | ○（迷いが減る） |
| D2 | ソート「科目」 | 科目バッジとフィルタがあれば足りる。ソートは季節/学年/名前/適用数の4つに | S | △ |
| D3 | 一覧の `curriculum` JOIN（`getSeasonalCourses` L407） | 一覧UIは使っていない。1,265件×単元の転送が丸ごと無駄 | S | ○（初期表示が速くなる） |
| D4 | 新規作成モーダルの「合計コマ数」「コメント」入力 | コマ数は単元から自動計算される値。作成時に手で入れさせるのは矛盾。コメントはエディタで | S | ○ |
| D5 | スクロール位置の sessionStorage 保存（L178-211） | URL同期で復帰できる。タイプ1文字ごとにリスナ貼り直しの原因 | S | △ |
| D6 | 詳細ページの `groupCourseCurriculumItems` / `ungroupCourseCurriculumItems` サーバー往復 | §3 でローカル状態化するので不要になる | （§3に含む） | — |

### 2-2. 直すもの（作法の統一・小改修）

| # | 項目 | 現状 | 工数 | UX |
|---|---|---|---|---|
| F1 | `window.confirm` / `alert` を `useConfirm` + Toast に | L318, L335, L346。詳細ページとは作法が違う | S | ○ |
| F2 | 削除ボタンの hover 依存をやめる | `opacity-0 group-hover:opacity-100`。タッチで押せない | S | ○ |
| F3 | 新規作成モーダルを共通 `Modal` に | 素の `fixed inset-0` div | S | △ |
| F4 | 季節の色・ラベルを1か所へ | `SEASON_COLORS` が一覧/詳細/apply の3ファイルに重複 | S | △ |
| F5 | フィルタ解除に文字ラベル | X アイコンだけでトグル群に埋没 | S | △ |
| F6 | 成功トーストを出す | 作成・削除が無言で終わる | S | ○ |
| F7 | `getCourseApplications` にページング | `.range()` 無し。1,000行で静かに切れる（適用152コース分なので今は未発症） | S | — |
| F8 | 一括操作バーを単一教室でも出す | `canDeploy` 条件でしか出ないので一括削除が使えない | S | ○ |
| F9 | 「下書き N件」の文言 | 何の下書きか分からない。「適用 N名」に | S | ○ |

### 2-3. 足すもの（母数を減らす）

| # | 項目 | 内容 | 工数 | UX |
|---|---|---|---|---|
| A1 | 「未設定」の可視化と一括削除 | 単元ゼロのコースにバッジ、フィルタ「未設定のみ」、一括削除。413件を掃除できる | M | ◎ |
| A2 | 有効/アーカイブの切替 | `is_active` を一覧で切り替え可能に。既定は有効のみ。翌年度の「来年問題」（year 列が無い）もこれで運用できる | M | ◎ |
| A3 | 「全教室に展開」の表示統合 | 同名・同季節・同学年を1行に畳み、教室数バッジを付ける。展開の実態が見える | M | ○ |
| A4 | **空のテンプレは展開できないガード** | 単元ゼロのコースを選んで「全教室に展開」を押せないようにする（理由を出す）。冬期の268件はこれが無かったせいで生まれた。§4-1 参照 | S | ◎ |

A3 はデータ変更なし（表示側のグルーピングのみ）。A1・A2 を先にやれば母数は数百件に落ちる見込み。

### 2-4. 一覧の優先順

1. ~~D3 + F1 + F2 + F6 + F9 + **A4**~~ → **2026-09-04 実装済み**（§2-5）
2. A1 + A2（掃除の道具）
3. D1 + D2 + D4 + D5 + F3〜F5 + F8（作法整理、§3 とまとめてやる）
4. A3（余力があれば）

### 2-5. 実装済み（2026-09-04・PR #142）

| 項目 | 内容 |
|---|---|
| D3 | 一覧の単元JOINを件数取得に置換。`curriculum:seasonal_course_curriculum(count)`。有効コース全体で単元は約1.7万行あり、以前は単元＋教材マスタまで結合していた |
| A4 | 単元ゼロの講習を選んで「全教室に展開」を押すと、講習名を挙げて止める。バナーは消えないので直しに行ける |
| A1（一部） | 単元ゼロの行に「未設定」バッジ。フィルタと一括削除は未実装 |
| F9 | 「下書き N件」→「適用 N名」に文言修正 |
| F1 | `window.confirm` / `alert` を `useConfirm` + Toast に置換。エラーバナーは残す（展開ガードの案内が消えると困るため） |
| F2 | 削除ボタンの `opacity-0 group-hover` を廃止し常時表示。`aria-label` も追加 |
| F6 | 作成・削除・展開の成功トースト |

新しい型 `SeasonalCourseListItem`（`curriculum_count` / `application_count` を持つ軽量版）を追加し、一覧の `getSeasonalCourses` はこれを返す。詳細ページ用の `getSeasonalCourse`（単体）は従来どおり中身まで取る。

触ったファイル: `src/types/database.ts` / `src/lib/api/seasonalCourses.ts` / `src/app/courses/page.tsx` / `src/app/students/[studentId]/progress/LegacyProgressPage.tsx` / `src/app/help/page.tsx` / `src/__tests__/lib-api/seasonalCourses.test.ts`

検証: 型チェック・ESLint・Prettier・単体テスト5件すべて通過。`/courses` は dev サーバーで200を返しコンパイルエラーなし。**画面の目視はログインが要るため未実施**。

### 2-7. 実装済み 第2弾（2026-09-05）

§2 の残り全部と、テンプレート編集画面の作り直しを実施。

**一覧**: D1（学年ジャンプ付きカスタムスクロールバーを削除）/ D2（科目ソートを削除）/ D4（作成時のコマ数・コメント入力を削除）/
D5（スクロール位置の保存を削除）/ F3（共通 `Modal` へ→のちに新規作成モーダル自体が不要に）/ F4（季節の色を `course-shared/seasonBadge.ts` に集約）/
F5（絞り込み解除に文言）/ F7（`getCourseApplications` を全件ページング）/ F8（一括操作バーを単一教室でも表示）/
**A1**（「未設定のみ」フィルタ＋一括アーカイブ）/ **A2**（有効・アーカイブの切替と「戻す」）。

★**「削除」は論理削除だったので、UI文言を実態に合わせて「アーカイブ」に統一した。** 完全削除の機能は作っていない。

**編集画面**: §3-5-0 の設計どおり `CourseEditor` を新設し、`/courses/[courseId]` は44行の薄いページになった（旧947行）。
`/courses/new` を追加し、一覧の「新規作成」はモーダルではなくこのページへ飛ぶ。**作成→一覧→詳細で設定という2段構えを廃止**。
編集画面からもアーカイブできるようにした（一覧まで戻らせない）。

**消したもの**: `groupCourseCurriculumItems` / `ungroupCourseCurriculumItems`（結合をローカル状態にしたので不要）/
`saveCourseCurriculum`（未使用）/ `convertToCourseCurriculumRows` と `CourseCurriculumRow`（旧疑似テーブルの表示変換。UIごと無くなった）/
リポジトリ直下の孤立ディレクトリ `courses/`（§2-6）。

**足したAPI**: `replaceCourseCurriculum`（削除→挿入。`saveBulkCourseCurriculum` は upsert なので、コマ0に戻した単元の古い行が残る）/
`restoreSeasonalCourse` / `archiveSeasonalCourses` / `getSeasonalCourses` の第2引数 `isActive`。

**直したバグ**: `UnitRow` の意図タグ開閉ボタンが押しても何も起きなかった（`expanded` を誰も見ていなかった）ので、
効いていない制御を削除。`/courses/[courseId]/apply` に権限チェックが無かったので追加。編集画面は権限判定を先頭に移した。

検証: 型チェック0件 / テスト128ファイル1735件パス / `npm run format:check` 通過。**画面の目視は未実施（要ログイン）。**

### 2-8. 適用で結合した単元が落ちていた（2026-09-05 修正）

`applyCoursesToStudents` は単元を `proposal_count > 0` で絞っていた。ところが「先頭のみ規約」では
**グループの2件目以降は0コマ**なので、講習を生徒に適用すると**まとめた単元が先頭1件だけになって渡っていた**。

本番の実例: 「中3国語 論説文・物語文の読解指導」はテンプレ側に42行の単元があり、うちコマ数が入っているのは22行。
この講習を適用された生徒の提案書は22行しか無く、結合相手の20行が落ちていた。講師には「第1回」だけが見えて、
束ねたはずの第2回以降が見えない状態だった。

| 季節 | 結合を使う講習 | 適用で落ちる単元 | 適用済み |
|---|---|---|---|
| 春期 | 1 | 2 | 7件 |
| 夏期 | 157 | 1,389 | 596件 |
| **冬期** | **0** | **0** | **0件** |

取り込み側（`courseSettingsToDrafts`）は同じ理由で既に0コマの結合メンバーを残していた。適用側だけ直し忘れていた。
判定を `pickCourseSettingsForApply` に1本化し、両方が同じ規約を見るようにした。

**夏期の既存データは直さない**（ユーザー決定 2026-09-05）。すでに実施済みで、提案書は公開後に手で編集されている。
冬期は結合の利用も適用もまだゼロなので、コードを直せば最初から正しく回る。

### 2-9. 新規作成の既定シーズン（2026-09-05）

雛形は実施の数か月前から作るのに、新規作成の既定が「今のシーズン」だった。9月に冬期の雛形を作るのに
毎回「夏期」から選び直すことになる。`getPreparingSeason()`（1〜3月=春 / 4〜8月=夏 / 9〜12月=冬）を足し、
`CourseEditor` の新規作成だけで使う。

既存の `getCurrentSeason()` は**変えない**。あちらは提案書一覧や進行表同期で「今どのシーズンか」の
絞り込みに使われており、意味が違う。

★提案書エディタ（`ProposalEditor`）の新規作成も同じ理由で `getCurrentSeason()` を使っており、
9月に作ると夏期になる。同じ違和感があるはずだが、今回は指示の範囲外なので触っていない。

### 2-6. リポジトリ直下の孤立コピー（2026-09-05 削除済み）

`courses/page.tsx` ほか2ファイル。2026-01-20 の1コミットで入ったきりの重複で、ルート直下に `app/` が無いため
**Next.js のルーティング対象外＝配信されない死にコード**だった。にもかかわらず `tsconfig.json` の `include` が
`**/*.tsx` で拾うため型チェックの対象に入り、`saveCourseCurriculum` の削除を塞いでいた。

削除した。git 履歴に残っているので必要なら取り戻せる。

## 3. 詳細ページを提案書エディタに揃える（本題）

### 3-1. ゴール

テンプレを作る操作を、生徒の提案書を作る操作と **同じ手つき** にする。
教室長が覚える操作は1種類。テンプレ→提案書の取込（`handleImportCourse`）と提案書→テンプレの登録（`promoteProposalToCourse`）で **画面が同じに見える** こと。

### 3-2. 揃えるもの／揃えないもの

| 提案書エディタの要素 | テンプレ | 備考 |
|---|---|---|
| テキストピッカー（検索・3フィルタ・お気に入り・全画面差し替え） | **同じ** | `TextbookPicker` として共通化 |
| 単元は全件表示、行クリックで+1、−/+ステッパー | **同じ** | 「提案回数0=使わない」の暗黙規約はそのまま |
| Shift範囲・チェックなぞりドラッグ選択 | **同じ** | `useUnitSelection` |
| 「まとめる」フローティングピル・Gキー・Esc | **同じ** | `SelectionPill` |
| 指導意図タグ | **同じ（列追加）** | `seasonal_course_curriculum.intent_tag` を足す。取込時に意図も渡せるようになる |
| スティッキーボトムバー（合計／選択数／グループ化／保存） | **同じ** | 子要素をスロット化 |
| 保存＝ローカル状態を「保存」でまとめて送る | **同じ** | グループ化のサーバー往復API（D6）は廃止 |
| テーマ（必須） → コース名 | **同じ位置・同じ見た目** | ラベルだけ「テンプレ名」 |
| 備考 → コメント | **同じ** | |
| 申込コマ列・申込結合 | **出さない** | 生徒固有 |
| 指導済バッジ・打ち消し線 | **出さない** | `done={false}` |
| ステータス・公開・発注ダイアログ・プレビュー印刷 | **出さない** | |
| 「ひな形取込」 | **出さない** | 向きが逆 |
| 季節・年度 | **季節のみ** | コースに year は無い（A2 のアーカイブで運用） |
| — | **対象学年チップ** | テンプレ固有。ヘッダのテーマ欄の下に学年チップ（複数選択） |
| — | **テキストタブ（最大3）** | テンプレ固有。タブごとに同じ単元リスト。ローカル状態はテキストIDでキー分け |

### 3-3. 新規作成フロー（2段構えを廃止）

現在: 「+新規作成」→ モーダル（名前・季節・学年・コマ数・コメント・全教室）→ 作成 → 一覧 → 行クリック → 詳細 → テキスト追加 → 単元設定 → 保存。**空殻が413件できた原因**。

新: 「+新規作成」→ `/courses/new` をエディタで開く → **提案書と同じくテキストピッカーから始まる** → テキスト選択 → テンプレ名・季節・学年 → 単元 → 保存で初めて `seasonal_courses` が作られる。

- 保存時に `createSeasonalCourse` → `addTextbookToCourse` → `saveBulkCourseCurriculum` を1つの関数 `saveCourseDraft` にまとめる。
- 「すべての教室に適用」は保存時のチェックとして残す（展開は `deployCourseToSchools` を保存後に呼ぶ）。
- 既存の空殻は A1 で掃除する。

### 3-4. 共通部品の切り出し（ProposalEditor 側の先行リファクタ）

置き場: `src/components/koushu-plan/`（提案書とテンプレの両方が使う。course-shared は B 系が居るので使わない）。

| 部品 | 元の場所（ProposalEditor.tsx） | 依存 |
|---|---|---|
| ~~純粋ロジック~~ `unitDraftLogic.ts` | **2026-09-04 実装済み**（§3-4-1） | `UnitDraft` |
| `useUnitDrafts(items)` | `unitDrafts` Map、`updateUnit`、`nextGroupId`（残り。ロジック本体は上に移動済み） | `UnitDraft` |
| `useUnitSelection(items, drafts)` | ドラッグの ref・自動スクロール・ピル位置・G/Escキー（純粋部分は上に移動済み） | なし |
| `<TextbookPicker>` | 絞り込み・並び順は `textbookPicker.ts` に**実装済み**。JSXの切り出しは未 | `getTextbooks`、お気に入りAPI |
| `<UnitList>` | 1610-1644 | `UnitRow` |
| `<SelectionPill>` | 1664-1742 | 申込結合ボタンはスロット |
| `<StickyActionBar>` | 1745-1819 | 子要素スロット |
| `proposalEditor.shared.ts` | そのまま移動 | — |

`UnitRow` は `appliedMode={false}` でも申込±が出る箇所があるので、`showApplied` prop を足して非表示にできるようにする。

**ここまでは挙動を変えない。** 提案書で回帰確認してから §3-5 へ。

#### 3-4-1. 実装済み: `src/components/koushu-plan/unitDraftLogic.ts`（2026-09-04・PR #142）

ProposalEditor には**テストが1本も無く**、画面の目視にはログインが要る。挙動不変を保証できないまま大きく動かすのは危険なので、
まず React に依存しない部分だけを純粋関数として切り出し、テストで固定した。

切り出した関数: `getSelectionInfo` / `selectedIndices` / `groupSelectedUnits` / `ungroupAllInGroup` /
`buildGroupMap` / `setSelectionRange` / `applyDragRange` / `selectionSnapshot` / `clearSelection`。

- 提案結合と申込結合は「触る列が違うだけで操作は同じ」なので `GroupKind = 'proposal' | 'applied'` で1本化した。
  ProposalEditor 側の `groupSelected` / `groupAppliedSelected` は `groupSelectedBy(kind)` の薄い包みになった。
- 固定した規約: 隣接2件以上のみ結合 / まとめ直しで片割れ1件になった旧グループは解散 / コマ未入力は結合時に1を入れる /
  なぞりドラッグは範囲外を開始時の状態へ戻す（ラバーバンド）。
- 引数の `anchorIdx` / `currentIdx` は**IDではなく並び順のインデックス**。ここを取り違えやすいのでテストにも注記した。

テストは `src/__tests__/components/unitDraftLogic.test.ts` に23件。

続けてテキストピッカーの絞り込み・並び順も `src/components/koushu-plan/textbookPicker.ts` に切り出した
（`filterAndSortTextbooks` / `textbookFilterOptions`、テスト12件）。並び順「お気に入り→教科→学年→名前」を固定。

**この時点までの累計**: ProposalEditor は 1942 → 1750 行。`koushu-plan/` に純粋モジュール3本（`unitDraftLogic` /
`courseSettingAdapter` / `textbookPicker`）とテスト47件。
検証: 型チェック・ESLint・Prettier・**全テスト1128件（90ファイル）通過**。dev サーバーで `/courses` と
`/courses/proposals` が200・コンパイルエラーなし。**画面の目視はログインが要るため未実施。**

### 3-5. テンプレエディタ `CourseEditor`

- `src/components/koushu-plan/CourseEditor.tsx`（新規）。`/courses/[courseId]/page.tsx` と `/courses/new` から呼ぶ。
- 変換アダプタは **2026-09-04 実装済み**（§3-5-1）:
  - `courseSettingsToDrafts(base, settings, startGroupId)`
  - `draftsToCourseSettings(units, orderedIds)`
- 規約は維持する:
  - `group_id: 0` ⇔ `group_number: null`
  - グループ内コマ数は **先頭行にだけ値、残りは0**。`applyCoursesToStudents` と `handleImportCourse` がこの前提。変えない。

#### 3-5-0. `CourseEditor` の設計（2026-09-05 確定）

**置き場**: `src/components/koushu-plan/CourseEditor.tsx`。
`/courses/[courseId]`（既存の編集）と `/courses/new`（新規作成）の両方から同じ部品を呼ぶ。

**画面の流れ**（提案書エディタと同じ手つき）:

1. テキスト未選択なら**テキストピッカーが全画面で開く**（新規作成は必ずここから始まる）。
2. エディタ本体。上からテンプレ名・季節・対象学年 → テキストのタブ → 単元リスト → スティッキーな下部バー。
3. 保存で初めて `seasonal_courses` の行ができる（新規の場合）。

**状態の持ち方**:

```
name / season / targetGrades[] / comment      … メタ情報
textbooks[]（最大3冊）/ selectedTextbookId      … テキストのタブ
unitsByTextbook: Map<textbookId, { items, drafts }>
nextGroupId                                     … コース全体で通し番号
```

★**テキストごとの編集内容を全部メモリに持つ**。旧実装はタブを切り替えると未保存の入力が警告なく消えていた（`proposalCountValues` を毎回リセットしていた）。全部持てばこの問題が消える。

★**グループ番号はコース全体で通しにする**。旧実装のサーバー側採番は「そのコースの最大値+1」でテキストを跨いで一意だった。
テキスト内だけで採番すると他テキストと衝突する。表示色と `G{n}` ラベルにしか使わないので実害は薄いが、意味づけを変えない。

**保存**（1回の操作で全部書く）:

1. 新規なら `createSeasonalCourse`、既存なら `updateSeasonalCourse`
2. テキストの追加・削除を読み込み時との差分で反映
3. テキストごとに `replaceCourseCurriculum`（後述）で単元設定を丸ごと書き換え
4. `total_koma` は全テキストの `calcTotalKoma` の合計

★**`saveBulkCourseCurriculum` は upsert しかしないので、そのままでは使えない。**
コマ数を0に戻した単元は書き出し対象から外れるため、DBに古い行が残って復活してしまう。
提案書側の `saveProposalUnits`（全削除→全挿入）と同じ意味論の **`replaceCourseCurriculum(courseId, textbookId, settings)`** を新設し、
そのテキストぶんの行を消してから入れ直す。既存の `saveBulkCourseCurriculum` は
`promoteProposalToCourse`（新規コースへの初回書き込み）専用として残す。

**旧実装から捨てるもの**:

| 捨てるもの | 理由 |
|---|---|
| `groupCourseCurriculumItems` / `ungroupCourseCurriculumItems` | 結合をローカル状態にするのでサーバー往復が不要。`saveBulkCourseCurriculum` は `group_number` も送れる |
| `saveCourseCurriculum`（単数形） | `src/` から一度も呼ばれていない死にコード |
| 「提案回数を保存」ボタン | 保存は下部バーの1本に集約 |
| 基本情報の編集モード（`isEditingBasic`） | 編集中に下のセクションが丸ごと消える作りをやめ、常に編集できる形にする |
| 疑似テーブルの単元表 | `UnitList` + `UnitRow` に置き換え。行クリックで+1・なぞり選択・「まとめる」ピルが使えるようになる |

**旧実装の往復回数**: `handleSaveProposalCounts` はテキスト N 冊で **N+5 回**のAPI往復をしていた
（同じ `getCourseCurriculum` を3回呼ぶ重複を含む）。新実装は「更新1 + テキスト数ぶんの置き換え」に収まる。

**申込と指導意図は出さない**: `UnitRow` に `showApplied={false}` `showIntent={false}` を渡す。
テンプレートに申込コマは無く、指導意図は生徒ごとに決めるもの（§4 の決定1）。

**権限**: 旧実装は `isLoading` と `!course` の早期returnが権限チェックより先にあり、権限の無い利用者でもデータ取得が走っていた。新実装では権限判定を先頭に置く。
`/courses/[courseId]/apply` には権限チェックが**そもそも無い**ので、あわせて `canAccessCourses` を入れる。

#### 3-5-1. 実装済み: `courseSettingAdapter.ts` と、見つかったコマ数の膨らみ（2026-09-04・PR #142）

アダプタを書く過程で、**書き手2つが別々の規約で書いていた**ことが分かった。

| 書き手 | 結合内の書き方 |
|---|---|
| 詳細ページの「提案回数を保存」 | 先頭に値・残り0（正） |
| `promoteProposalToCourse`（提案書の「講習に登録」） | **全メンバーに値**（誤） |

読み出し側 `convertToCourseCurriculumRows` はグループ内の `proposal_count` を**合計**するため、後者で作られた講習は
テンプレート画面のコマ数がメンバー数ぶん膨らんで見える。本番の実害は次のとおり。

| 指標 | 値 |
|---|---|
| 結合グループ総数 | 1,440 |
| 先頭のみ規約（正しい） | 1,279 |
| 全メンバーに値（膨らむ） | 161 |
| その161グループの表示合計 | 366コマ |
| 本来の合計 | 172コマ |

対応: `promoteProposalToCourse` を `draftsToCourseSettings` 経由に変更し、先頭のみ規約に統一した。
提案書側の「ひな形取込」も `courseSettingsToDrafts` に置き換え、規約をアダプタ1か所に集約。
テストは `src/__tests__/components/courseSettingAdapter.test.ts` に12件（往復変換で合計コマ数が保たれることを含む）。

**既存161グループのデータ是正は未実施**（本番データの変更なのでユーザー判断待ち）。内訳を調べたところ、
161グループのうち **150グループはメンバー全員が同じ値**なので「先頭に残す値」に迷いがない。
残り11グループだけ値がばらついている（1と2が混在）。是正は「グループ内の先頭以外の `proposal_count` を0にする」
UPDATE 1本で、ばらつく11グループは先頭の値を採用することになる。誤差は1グループあたり最大1コマ。
- テキストタブ切替で未保存が消える現バグは、状態を `Map<textbookId, Map<itemId, UnitDraft>>` で全タブぶん保持することで消える。
- 離脱ガード（`beforeunload`）は提案書にも無い。今回は両方に入れる（S）。

### 3-6. DB変更

| 変更 | 内容 | 影響 |
|---|---|---|
| `seasonal_course_curriculum.intent_tag text null` | 指導意図をテンプレに持つ | `handleImportCourse` で `intent_tag` を渡す。`promoteProposalToCourse` で保存する。1本のマイグレーション |

それ以外の列追加は無し。`total_koma` は今まで通り保存時に再計算して書く。

### 3-7. 工数

| 段階 | 内容 | 工数 |
|---|---|---|
| 1 | 共通部品の切り出し（挙動不変・提案書で回帰） | M（1.5日） |
| 2 | `CourseEditor` ＋ `/courses/new` ＋ 保存関数統合 ＋ 旧詳細ページ削除 | M〜L（2日） |
| 3 | `intent_tag` 列追加と両方向変換への反映 | S |
| 4 | 一覧の §2-4 手順1・2 | M（1日） |
| 5 | 実機検証（テンプレ作成→適用→提案書で開く→「講習に登録」で往復） | S |

合計 5〜6日相当。段階1は単独でマージ可（提案書のリファクタとして価値がある）。

### 3-8. 実装順

1. §3-4 部品切り出し（PR 1本）
2. §3-5 + §3-6 テンプレエディタ（PR 1本。ここで `groupCourseCurriculumItems` 系と `saveCourseCurriculum`（未使用疑い）を削除）
3. §2 一覧改修（PR 1本）
4. ヘルプ FAQ_DATA の「講習テンプレート」項目更新（作成手順が変わる）

## 4. 決定事項（2026-09-04 ユーザー決定）

1. **指導意図はテンプレに持たない**。§3-6 の列追加は無し。`intent_tag` は提案書だけの属性のまま。
2. **テキスト最大3冊の上限は残す**。
3. **空殻は SQL で一度掃除する**（A1 の一括削除UIも作る）。掃除の条件は §4-1。
4. A3（展開の畳み表示）は後回し。

### 4-1. 本番掃除と冬期の所属変更（2026-09-04 実施済み）

**運用の前提（ユーザー説明）**: 堀之内で作って全教室に展開するのが正しい運用。担当者が各教室で直接作ってしまったのが今回の散らかりの原因。

**分かったこと**: `deployCourseToSchools` は教材もカリキュラムも一緒にコピーする。よって展開先が空なのは「中身を入れる前に展開した」跡。冬期は永山91件・緑園91件がぴったり同数・堀之内と同名77件で、これに該当した。清瀬だけは別で、堀之内に無い名前で教材3冊まで入れた16件があった（担当者が独自に作り込んだぶん）。

**「空」と「生徒未適用」は別物**: 空＝単元ゼロ。適用＝`seasonal_course_applications`。単元ゼロで適用ありは全体で3件だけ（デフォルト教室の春期）。削除条件は必ず **単元ゼロ かつ 教材ゼロ かつ 適用ゼロ** にする。

**実施内容（冬期のみ。春・夏は触っていない）**:

| 操作 | 件数 | 内訳 |
|---|---|---|
| 削除 | 268 | 永山91・緑園91・清瀬86。すべて教材も単元も適用もゼロ |
| 堀之内へ移動 | 18 | 清瀬の教材付き（うち16件は堀之内に無い名前、2件は同名） |
| そのまま | 91 | 堀之内。空33・教材のみ36・単元あり22 |

結果、冬期は 京王堀之内校 109件のみ（単元あり22・教材のみ54・空33）。夏期953件・春期14件・適用履歴603件・提案書776件は無傷。孤児行なし。

削除前に `backup_winter_empty_courses_20260904` へ268件を退避済み（`revoke all from anon, authenticated` ＋ ポリシー無しでRLS有効。service_role のみ読める）。堀之内を仕上げて再展開すれば復元できるので、名前だけ残す目的の保険。不要になったら drop してよい。

## 5. 関連

- 講習データモデル: メモリ `講習_データモデル`（コースは単なるテンプレ、申込は `koushu_enrollments`）
- 提案書側の共有定数: `src/components/proposals/proposalEditor.shared.ts`
- 変換の現物: `ProposalEditor.tsx` `handleImportCourse`（560-615）、`proposals.ts` `promoteProposalToCourse`（811-871）
