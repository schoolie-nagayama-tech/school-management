# 報告書×進行表 統合フォーム 実装計画（P1-14 本実装）

作成: 2026-08-21 ／ 正典はこの文書。モック: claude.ai Artifact「報告書×進行表 統合フォーム案」

## 0. 決定事項（ユーザー確認済み）

| #   | 決定                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 報告書フォームは **上部＝報告書の内容 / 下部＝進行表** の2段構成にする                                                                                                                                                                         |
| 2   | 「本日の指導範囲」は手入力させず、下部の進行表セルのクリック結果を **自動反映** する                                                                                                                                                           |
| 3   | ヘッダーに **次回授業日** を出す（既存 `getLessonDates().nextLessonDate` を流用）                                                                                                                                                              |
| 4   | **遅刻・宿題未実施** は保護者公開ゾーンに移し、チェックボックスではなく **押すと色が付くマーク（トグルピル）** にする。保護者の報告書にも表示する                                                                                              |
| 5   | 宿題未実施マーク ⇄ 宿題実施率は **双方向同期**: マークON→実施率0% / 実施率を0%にする→マークON / 実施率>0→マークOFF。「やってきていない」も「忘れた」も同じ扱い                                                                                 |
| 6   | 下部の進行表は報告書に必要な列だけ（学校進度・1〜3回目）。既存 `REPORT_GRID_COLS` のまま。列の表示切替は従来の仕組み（localStorage 保存）を引き継ぐ                                                                                            |
| 7   | 下部へスクロールしたら **スティッキーバー**（指導範囲チップの要約＋「報告書へ戻る」）を出し、往復を減らす                                                                                                                                      |
| 8   | 生徒詳細側の「授業を記録」パネル（`SessionRecordingPanel`）は **将来廃止** で合意。ただし `class_reports.schedule_entry_id` が NOT NULL で新フォームは座席表のコマが無いと開けないため、**座席表の運用開始後に別PRで廃止**（本PRでは触らない） |

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

---

# フェーズ2: 記入支援4機能（A / G / E / F）

2026-08-21 決定。PR #64 と同じブランチに2本目のコミットとして積む。

## A. 前回の授業を折りたたみで表示

**目的**: 授業開始時に「前回の引継ぎ・やった単元」を見ながら書けるようにする。

**★ データ源は進行表の授業記録（`progress_sessions`）。報告書（`class_reports`）ではない**
（2026-08-21 本番データで確認して差し替えた決定）:

| テーブル            | 件数                    | 最新       | 直近30日                                |
| ------------------- | ----------------------- | ---------- | --------------------------------------- |
| `class_reports`     | 5件（テストデータのみ） | 2026-07-20 | **0件**                                 |
| `progress_sessions` | 4,734件                 | 当日       | 3,367件（うち `handover` 入り 4,485件） |

講師が実際に使っているのは進行表の授業記録であり、報告書はまだ運用されていない。
`class_reports` だけを見ると前回の授業カードは**実質どの生徒でも空になる**ので、
セッションを一次情報にして、報告書があるときだけ上乗せする。

- 新API `getPreviousLessonForStudent(studentId, beforeDate)`（`src/lib/api/class-reports.ts`。
  両方のテーブルを引くのでどちらに置いてもよいが、報告書フォーム専用の記入支援なので
  報告書側に置き、既存の型未登録テーブル用クライアント（`db`）をそのまま使う）
  1. **前回の授業日**: `progress_sessions` → `student_textbooks`（`student_textbook_id`）で
     `student_id` 一致・`session_date < beforeDate` の最大 `session_date`。
     その日の**すべてのセッション**（教材ごとに1件ずつ存在しうる）を取る。`.limit()` は明示する
  2. **セッションから取る**: `session_date` / `teacher_name` / `handover` /
     `homework_not_done` / `tardy` / 教材名（`student_textbooks` → `textbooks`）
  3. **その日にやった単元**: `student_progress_lessons.session_id` が対象セッションのものを引き、
     `student_progress_id` → `student_progress.curriculum_item_id` → `curriculum_items.title` で
     単元名を解決。`lesson_number`（1〜3回目）も持つ
  4. **報告書があれば上乗せ（任意）**: 同じ生徒・同じ `lesson_date` の `class_reports` を1件引き、
     あれば 講評 / 出した宿題 / 達成度3値 / 学校進度 を追加表示。**status は問わない**
     （承認待ちでも講師には見せる）。**無いのが普通なので、無くてもカードは成立させること**
- 置き場所: 授業情報サマリのカードの**直後**、目標ヘッダーの手前（今日のコマ → 前回どうだったか → 今日書く、の順）
- 折りたたみヘッダー（閉じていても見える）: `前回の授業 M/D(曜)` ／ 引継ぎの1行プレビュー（省略記号で切る）／ 遅刻・宿題未実施のマーク（あれば）／ 開閉シェブロン
- 展開時: 教材ごとに「教材名 → やった単元（n回目）」＋その教材の引継ぎ全文、講師名。
  報告書があれば 講評／出した宿題（日付＋内容）／達成度3値／学校の進度 も続けて出す。**空の項目は出さない**
- **引継ぎは教材（セッション）ごとに別々に入っていることがあるので、教材ごとに出す。1つに連結しない**
- 既定は**閉じた状態**
- 前回のセッションが1件も無ければカードごと出さない。`isDemo` はダミーの前回を出す

## G. 下書きの自動保存

**方針**: 手動の「下書き保存」とまったく同じ経路を、黙って・間引いて呼ぶだけ。別経路を作らない。

- `handleSave` の中身を `persist(nextStatus, { silent })` に切り出し、手動・自動の両方がこれを呼ぶ
- 発火: form / handover / selections のいずれかが変わってから **3秒間** 何も起きなければ1回
- 実行しない条件（どれか1つでも当てはまれば見送る）
  - `isDemo` ／ 初期ロード中
  - 既存報告書が `submitted` または `approved`（**新規・`draft`・`rejected` のときだけ動く**。提出済みを裏で書き換えない）
  - 手動保存が実行中、または自動保存が実行中（**ref のミューテックス**。state だと取りこぼす）
  - 前回保存に成功したときのスナップショットと中身が同じ（無変更では叩かない）
- 自動保存は `load()` を**呼ばない**（フォーカス・スクロール・入力中の値が飛ぶ）。返ってきた報告書は `existingReport` に**マージするだけ**
- 成功してもトーストは出さない。フッターの表示だけ変える
  - `未保存の変更があります` → `保存中…` → `自動保存 HH:MM`
  - 失敗時: フッターに `自動保存に失敗しました（手動で保存してください）`。トーストは出さない（連打になる）
- 未保存の変更があるときだけ `beforeunload` で確認を出す
- `upsertClassReport` は `schedule_entry_id` で既存を引き直すので、報告書IDを持ち回らなくても重複しない。セッションIDは既存の `onSessionSaved` でそのまま握る

## E. 保護者プレビュー

**方針**: 見た目を作り直さず、**保護者が実際に見るコンポーネントをそのまま描く**（作り直すと必ずズレる）。

- 純関数 `buildPortalPreview(...)`（`src/lib/lesson-reports/portalPreview.ts`）でフォームの現在値から `PortalReportDetail` を組み立てる。単体テストを付ける
- `ReportDetail` に `preview?: boolean` を追加し、true のときは**既読APIを叩かない**（`useEffect` の中で早期 return）。既定 false で既存の呼び出しは無変更
- 入口: フッターの「下書き保存」の隣に `保護者の見え方`（lucide の `Eye`）
- モーダル: 幅 **375px** の枠に収め、`max-h-[80vh]` でスクロール。見出し `保護者にはこう表示されます`、注記 `室長の承認後にマイページへ公開されます`
- 保存はしない（プレビューを開いても書き込まない）

## F. 提出前チェック

**方針**: ボタンを黙って無効化しない。何が足りないかを言い、その場所へ連れて行く。

- 純関数 `validateForSubmit(...)`（`src/lib/lesson-reports/submitValidation.ts`）＋単体テスト。戻りは `{ field, label, message }[]`
- 必須（これだけ。増やさない）
  1. **本日の指導範囲**: 進行表で1単元以上選ばれていること。ただし進行表の教材が0件の生徒は「プリント等の自由記述」が埋まっていればOK
  2. **引継ぎ**: 空でない
  3. **講評**: 空でない（保護者が読む本文が空の報告書を出させない）
- 挙動
  - 「提出」ボタンは**押せるまま**。押したときに検証し、足りなければフッター上に一覧パネルを出す
  - 一覧の各項目はボタン。押すとその入力欄へスクロールしてフォーカスする
  - 不足があるときは提出ボタンの隣に `未入力 N件` のチップを常時出す（押してから驚かせない）
- 「下書き保存」と自動保存は**止めない**

## 受け入れ基準（フェーズ2）

- `/lesson-reports/demo` で 前回の授業カード・保護者プレビュー・提出前チェックが動く（自動保存はデモでは動かないこと）
- `tsc --noEmit` 0件／`npm test` 全緑／prettier clean
- 新規テスト: `portalPreview` `submitValidation`（境界を固定）
- ヘルプ FAQ に 4機能を追記
