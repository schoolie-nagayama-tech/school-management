# 報告書×進行表 統合フォーム 実装計画（P1-14 本実装）

作成: 2026-08-21 ／ 正典はこの文書。モック: claude.ai Artifact「報告書×進行表 統合フォーム案」

## 0. 決定事項（ユーザー確認済み）

| # | 決定 |
|---|---|
| 1 | 報告書フォームは **上部＝報告書の内容 / 下部＝進行表** の2段構成にする |
| 2 | 「本日の指導範囲」は手入力させず、下部の進行表セルのクリック結果を **自動反映** する |
| 3 | ヘッダーに **次回授業日** を出す（既存 `getLessonDates().nextLessonDate` を流用） |
| 4 | **遅刻・宿題未実施** は保護者公開ゾーンに移し、チェックボックスではなく **押すと色が付くマーク（トグルピル）** にする。保護者の報告書にも表示する |
| 5 | 宿題未実施マーク ⇄ 宿題実施率は **双方向同期**: マークON→実施率0% / 実施率を0%にする→マークON / 実施率>0→マークOFF。「やってきていない」も「忘れた」も同じ扱い |
| 6 | 下部の進行表は報告書に必要な列だけ（学校進度・1〜3回目）。既存 `REPORT_GRID_COLS` のまま。列の表示切替は従来の仕組み（localStorage 保存）を引き継ぐ |
| 7 | 下部へスクロールしたら **スティッキーバー**（指導範囲チップの要約＋「報告書へ戻る」）を出し、往復を減らす |
| 8 | 生徒詳細側の「授業を記録」パネル（`SessionRecordingPanel`）は **将来廃止** で合意。ただし `class_reports.schedule_entry_id` が NOT NULL で新フォームは座席表のコマが無いと開けないため、**座席表の運用開始後に別PRで廃止**（本PRでは触らない） |

## 1. 変更範囲

### 1-1. DB（新規マイグレーション・本番適用は別途MCPで）

`supabase/migrations/20260821100000_class_reports_attendance_marks.sql`

```sql
alter table public.class_reports
  add column if not exists tardy boolean not null default false,
  add column if not exists homework_not_done boolean not null default false;
comment on column public.class_reports.tardy is '遅刻マーク（保護者公開）。progress_sessions.tardy と同じ値を提出時に写す';
comment on column public.class_reports.homework_not_done is '宿題未実施マーク（保護者公開）。homework_completion_pct=0 と同期';
-- 限定公開ビューに2列を追加（create or replace view public.portal_class_reports ... 既存定義を丸ごと再掲して2列足す）
```

ビュー再定義は `20260715000000_portal_v2_reports.sql` の定義をコピーして列を足す（select の列追加は `create or replace view` で可。列の並びは末尾に追加）。

### 1-2. 型

- `src/types/class-report.ts`: `ClassReport` / `ClassReportFormData` に `tardy: boolean` / `homework_not_done: boolean`
- `src/types/mypage-report.ts`: `PortalReportDetail` に `tardy: boolean` / `homeworkNotDone: boolean`
- `src/types/database.ts`: class_reports Row/Insert に2列（生成型の形式に合わせる）

### 1-3. 保存経路

- `src/lib/api/class-reports.ts` `upsertClassReport()`: 2列を書く
- `src/lib/api/progress-sessions.ts` `recordSession()`: 引数に `reportId?: string | null` を追加し `progress_sessions.report_id` に書く（列は本番に既存・未使用）。報告書ページは upsertClassReport の戻り値 id を渡す。既存の `tardy` / `homework_not_done` 書き込みはそのまま（進行表側の履歴表示に使っている）

### 1-4. 保護者面

- `src/lib/mypage/reports.ts`: `DETAIL_COLUMNS` に `tardy, homework_not_done` を追加しマッピング
- `src/components/mypage/ReportDetail.tsx`: 「本日の様子」として **どちらかが true のときだけ** 小さなピルを出す（遅刻 / 宿題未実施）。両方 false なら行ごと出さない。375px幅で設計

### 1-5. 報告書ページ `src/app/lesson-reports/[scheduleEntryId]/page.tsx`

新レイアウト（上から順）:

1. **ヘッダー行**: 生徒名・学年・教科（教材名）・授業日時・講師名・**次回授業日**（右端、`M/D（曜）` 形式。`nextLessonDate` が null なら「次回授業日 未定」）
2. `GoalHeaderCard`（試験目標・行動目標・カウントダウン）— 既存のまま
3. **公開ゾーン**（緑、既存 `Zone kind="public"`）の項目順:
   1. 今日の目標（既存）
   2. **本日の指導範囲**（自動反映バッジ付き）— 教材セットごとにグループ表示: 教材名＋メイン/サブ＋チップ（`単元名 ＋ n回目`）＋開始/終了ページ入力（既存 `PageInput`）。未選択なら「下の進行表で今日やった単元をクリックしてください」。チップは読み取り専用（解除は下の表のセルをもう一度クリック）
   3. **学校の進度**（自動反映）— 既存 `school_progress` 文字列の生成ロジックはそのまま。チップ表示
   4. **本日の様子** — トグルピル「遅刻」「宿題未実施」。`aria-pressed`。ON時は warning 系の色。補足文「該当するときだけ押します。保護者の報告書にも表示されます」
   5. 宿題・演習の達成度（既存3スライダー）。**同期**: 上記決定5（純関数 `applyHomeworkMark()` を `src/lib/lesson-reports/homeworkMark.ts` に切り出しテスト）
   6. 確認テスト（既存）
   7. 講評（既存）
   8. 次回までの宿題（既存。見出しに「次回授業日 M/D まで」を含める）
   9. 科目別欄（既存）
4. **内部ゾーン**（破線）: 引継ぎのみ。従来の「フラグ」チェックボックス行は削除
5. **スティッキーバー**: 公開ゾーンが画面上端から消えたら表示（IntersectionObserver のセンチネル方式）。内容＝「今日の指導範囲」ラベル＋チップ要約＋「報告書へ戻る ↑」ボタン（公開ゾーン先頭へ `scrollIntoView`）。AppHeader の高さ分 `top` をオフセット（進行表ヘッダー固定 PR #59 の実装を参照）
6. **下部：進行表** セクション: 見出し「進行表」＋ヒント「セルをクリックすると今日の日付が入り、上の指導範囲に反映されます」。教材セットごとに: メイン/サブバッジ＋教材 select＋削除ボタン＋`LessonReportProgressGrid`。末尾に「サブ教材を追加」ボタン（既存ロジック移設）
7. sticky フッター（下書き保存 / 提出）— 既存

状態・保存ロジックは既存のものを **移設** する（`units[]`, `gridSelections`, `handleCellToggle`, `recordSession` 呼び出し等）。作り直さない。`/lesson-reports/demo`（`isDemo`）も同じレイアウトで動くこと。

### 1-6. ヘルプ

`src/app/help/page.tsx` の `FAQ_DATA` 内、報告書の記入に関する項目を新レイアウトに合わせて更新（指導範囲は下の進行表から／遅刻・宿題未実施はマーク／次回授業日）。

### 1-7. ロードマップ

`docs/release-roadmap-2026H2.md` の P1-14 行に「入力UI統合 実装済（2026-08-21）／残＝生徒詳細側パネルの廃止（座席表運用後）」と追記。

## 2. 触らないもの

- `src/app/students/[studentId]/progress/TableView.tsx` / `SessionRecordingPanel.tsx`（決定8）
- `LessonReportProgressGrid.tsx` の列プリセット
- 承認フロー（pending / overdue / approve / reject）

## 3. 受け入れ基準

- `/lesson-reports/demo` で上下2段レイアウト・スティッキーバー・自動反映・マーク同期が動く
- `npx tsc --noEmit` 0件、`npm test` 緑、prettier clean
- 新規テスト: `homeworkMark` の同期規則（マークON→0 / 0→ON / >0→OFF / null は触らない）
- 保護者面 `ReportDetail` でマークが出る（両方 false のとき行が出ない）
