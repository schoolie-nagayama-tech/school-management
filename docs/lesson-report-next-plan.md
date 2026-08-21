# 機能D「次回の予定」 実装計画

作成: 2026-08-21 ／ 前提: PR #64（報告書×進行表 統合フォーム、main `cb7b4d4`）がマージ済み。
関連: `docs/lesson-report-session-merge-plan.md`

## 0. なにを作るか

報告書フォームで「次回やる単元」を記録する。次回の授業では、その内容が「前回の授業」カードに
**前回の予定**として出る。保護者の報告書にも「次回の予定」として出す。

### なぜ作るか（本番データの裏付け）

`progress_sessions.handover` の実データに **「次回：進行表通り」「次回、進行表通り」** という
手打ちが多数ある。この機能はその入力をそのまま置き換える。だから既定値は
**「進行表通り」を自動で入れる**（講師が何もしなくても正しい状態になる）のが要件。

## 1. 設計

### 1-1. 既定は自動、変更は任意

- **既定（自動）**: 今日やった単元より後ろで、まだ3回とも埋まっていない**先頭の1単元**
  - 「今日やった単元」＝進行表グリッドで選択中の単元。教材セットごとに独立に計算する
  - 今日の選択が変わると自動値も追従する（講師が触っていない限り）
- **変更（手動）**: 「変更」ボタンでピッカーを開き、単元をトグルで選び直す。複数可
  - 一度手で触ったら、以後その教材セットは自動追従をやめる（手で決めた値を勝手に書き換えない）
  - ピッカーで全部外して空にした場合も「手動で空」として扱う。自動に戻す導線は
    ピッカー内の「進行表通りに戻す」ボタン
- 保存されるのは**最終的に表示されている単元ID**（自動・手動を問わず同じ形で保存する）。
  「自動か手動か」はDBに持たない（表示のたびに再計算しないため。保存時点の確定値が正典）

### 1-2. 進行表の列は増やさない

`ProgressRow` に列を足すと `TableView`（現行運用中の進行表）も変わってしまう。
**行に「次回」バッジを付けるだけ**にする。バッジは `LessonReportProgressGrid` の
ラッパー側で描画し、`ProgressRow` には手を入れない。

### 1-3. 置き場所

報告書フォームの**保護者公開ゾーン**、「本日の様子」の直後・「宿題・演習の達成度」の手前。

## 2. DB（新規マイグレーション。適用は別途 MCP で）

`supabase/migrations/20260822090000_next_lesson_plan.sql`

```sql
-- 次回の予定（機能D）。
alter table public.progress_sessions
  add column if not exists next_plan_curriculum_item_ids integer[] not null default '{}'::integer[];
comment on column public.progress_sessions.next_plan_curriculum_item_ids is
  '次回やる予定の単元ID。次回授業の「前回の授業」カードに前回の予定として出す';

-- 保護者面に出すためのスナップショット（名前で持つ。単元IDを保護者に露出させない）。
alter table public.class_reports
  add column if not exists next_plan jsonb not null default '[]'::jsonb;
comment on column public.class_reports.next_plan is
  '次回の予定のスナップショット [{textbookName, unitTitles[]}]。保護者公開';

-- portal_class_reports ビューに next_plan を追加（末尾に足す。既存列の並びは変えない）
```

★ ビュー再定義は `20260821100000_class_reports_attendance_marks.sql` の定義を丸ごとコピーし、
`cr.next_plan` を **select の末尾** に足す。他の列・join・述語は一切変えない。

★ どちらも「既定値つきの列追加」なので、現行運用中の進行表の挙動は変わらない。
`recordSession` は今回も、報告書から呼ばれたときだけ新列を書く（進行表の授業記録パネルから
呼ばれたときは列を patch に載せない）。`report_id` と同じ作法にすること。

## 3. 実装

### 3-1. 純関数（テスト必須）

`src/lib/lesson-reports/nextLessonPlan.ts`

- `computeAutoNextPlan(rows, taughtItemIds): number[]`
  - `rows` はグリッド行（カリキュラム順・各行の1〜3回目の埋まり具合を持つ）
  - 今日やった単元の**最後尾より後**で、`lesson1..3` のいずれかが空いている先頭の1件を返す
  - 今日の選択が空なら「まだ終わっていない先頭の単元」を返す
  - 該当なしなら `[]`
- `resolveNextPlan(auto, manual): number[]` … `manual === null ? auto : manual`

テスト: `src/__tests__/lib/lessonReportNextPlan.test.ts`（境界＝選択なし／最終単元／全部終了済み／
手動で空／手動で複数）

### 3-2. 状態

`GridSelectionState` に `nextPlanManual: number[] | null` を足す（`null` = 自動）。
既存セッションからの復元時は、DBに保存された配列をそのまま `nextPlanManual` に入れる
（保存済み＝確定値なので自動追従させない）。

### 3-3. 保存

- `recordSession` に `nextPlanCurriculumItemIds?: number[] | null` を追加。
  **`undefined` のときは列を patch に載せない**（進行表からの保存を1バイトも変えない）
- `upsertClassReport` は `next_plan`（教材名＋単元名の配列）を書く

### 3-4. 表示

- **報告書フォーム**: 「次回の予定」セクション。バッジ `進行表通り` / `変更あり`、
  チップ、「変更」ボタン→ピッカー（単元トグル＋「進行表通りに戻す」）
- **進行表グリッド**: 予定の行に `次回` バッジ
- **前回の授業カード（A）**: `getPreviousLessonForStudent` の戻りに
  `nextPlanUnits: string[]`（教材ごと）を足し、`前回の予定：一次関数` の行を出す
- **保護者（`ReportDetail`）**: 「次回の予定」セクション。`next_plan` が空なら出さない
- **保護者プレビュー（E）**: `buildPortalPreview` に `next_plan` を通す

### 3-5. その他

- ヘルプ `src/app/help/page.tsx` の FAQ に「次回の予定」を追記
- `/lesson-reports/demo` でも動くこと（ダミーで自動値が入る）

## 4. 触らないもの

- `src/app/students/**`（TableView・ProgressRow・進行表ページ）
- `src/components/progress/SessionRecordingPanel.tsx`
- 承認フロー、`lesson-reports/sample`

## 5. 受け入れ基準

- `/lesson-reports/demo` で、進行表のセルをクリックすると「次回の予定」が追従する
- 「変更」で選び直すと追従が止まり、「進行表通りに戻す」で戻る
- `tsc --noEmit` 0件／`npm test` 全緑／prettier clean
- `git diff main -- src/app/students src/components/progress` が**空**であること（回帰防止）
