# スケジュール機能リプレース — 引き継ぎノート

> 2026-04〜05 にかけて、生徒×講師スケジューリング機能を一から組み上げた作業の進捗・設計意図・残課題をまとめた引き継ぎ資料。次の会話で続きをやる人/AI 向け。

---

## 1. このプロジェクトの何をやっているのか

**目的**: 既存外部システムで管理している「生徒×講師の通常授業スケジュール + 講習スケジュール」を、NEST(school-management) に内蔵する。教室長が「楽に・ミスなく・わかりやすく」スケジューリングできるのが最上位ゴール。

**現状の運用方針**:
- 入口は **目立たない場所に維持**（既存ユーザーが触らないように）
- 完成までリリースしない / 並行運用しない
- 生徒アカウントは未整備（リリース前に整備が別タスクで必要）
- 講師アカウントは既存だが「この機能の存在を知らせない」

**設計の核**:
- 通塾日程 (`schedule_regular_patterns`) = 毎週同じ曜日のルーティンを設計するルール
- 座席表 (`schedule_entries`) = そのルールから生成される実際の授業コマ
- 講習 (`course_prep_periods` + 生徒別プラン `seasonal_courses/koushu_enrollments`) = 春期/夏期/冬期の3種、日程は独立
- マッチング = ルール (通塾日程) に「講師」をシフトと希望ルール考慮で割り当てる作業

---

## 2. 用語・概念マップ

| 概念 | テーブル / API | 役割 |
|---|---|---|
| 通塾日程 | `schedule_regular_patterns` | 生徒×曜日×コマ×（講師）×科目 のルール。期間 (effective_from/until) 持ち |
| 座席表エントリ | `schedule_entries` | 1コマ1生徒1講師の実績レコード。kind/formation/transfer_deadline 持ち |
| コマ時間 | `schedule_time_slots` | formation (個別/集団) で別建て |
| 休講日 | `schedule_closed_days` | 全校共通 or 校別 |
| 講習期間 | `course_prep_periods` | season(spring/summer/winter) × year × school → start/end_date |
| 講習プラン | `seasonal_courses` + `koushu_enrollments` | 生徒別の「何やるか」。**日程とは独立** |
| 通常シフト | `regular_shift_settings` (期間付) + submissions + slots | 講師の曜日×時間帯シフト |
| 講習シフト | `seasonal_shift_settings` (start/end_date) + submissions + slots | 講師の期間シフト |
| 生徒の通塾可能表 | `seasonal_shift_student_submissions` + slots | 講習用、保護者ポータルから送信 |
| マッチング提案 | `schedule_match_batches` + `schedule_match_proposals` | 自動マッチング結果の下書き保管 |
| 授業生徒数設定 | `school_class_capacity` | 学校別の人数上限 (個別 1講師2まで / 教室12席 等) |
| 授業報告書 | `class_reports` + `lesson_report_units` | 講師が毎授業書く報告書 + 進行表双方向リンク |
| 振替期限 | `schedule_entries.transfer_deadline` | 元授業日の翌月末日 |
| 振替通知 | `transfer_notifications` | 保護者通知レコード（実送信は将来 Edge Function） |
| ブース番号 | `schedule_daily_booth_assignments` | 印刷用、講師×日付→番号 |
| 担当未決定 | `schedule_entries.teacher_id IS NULL` | 通塾日程の teacher_id が未決の生徒も座席表に出す |

---

## 3. 完了したフェーズと意図

### Phase 0 (ccaf8e7) — 基盤データ層
- `schedule_entries` / `schedule_regular_patterns` に `kind` (regular/koushu) / `formation` (individual/group) 追加
- コマ時間マスタを formation で別建て (UNIQUE 制約も formation 込み)
- `students` に講師希望 (preferred_teacher_gender / fixed_teacher_ids / excluded_teacher_ids)
- `user_profiles` に gender
- `school_class_capacity` テーブル新規 + `/settings/class-capacity` 設定UI
- `schedule_versioning` (effective_from/until + withdrawal_date) アプリ側ロジック仕上げ

### Phase 1 (86b983e) — 既存スケジュール即効改善
- 日次印刷ビュー + 講師ブース番号 (`#` アイコンで日別に番号設定)
- 振替期限 (元授業日の翌月末) 自動セット + 座席表に残日数チップ
- 振替期限切れ督促ボード (`PendingTransfersBoard`)
- 同時刻重複バリデーション (個別↔集団の時刻範囲も検出)
- 勤怠チェック画面 (`ScheduleDriftCheckPanel`) — 出勤簿は連動せず、室長が並列で目視チェック

### Phase 2 (1364f72) — 授業報告書
- `class_reports` + 子テーブル `lesson_report_units` (メイン+サブ教材セット)
- 3層目標 (中期教材/中期行動/短期この授業)
- 学校進度・授業単元は **進行表へ双方向転記**
- 宿題日割り (次回授業日まで等分配・枠は可変・日付ピル)
- 科目別欄 (英語=単語練習 / 数学=計算 / 国語=漢字)
- `/lesson-reports/[scheduleEntryId]` フォーム
- `/today` 講師向け本日の授業
- `/lesson-reports/pending` 室長承認画面
- `/lesson-reports/overdue` 督促画面
- `/students/[id]/lesson-reports` 過去報告書一覧

### Phase 3 (618fb47) — 講習マッチング基盤
- 生徒版 seasonal-shifts (通塾可能フォーム + 公開送信API)
- `schedule_match_batches` / `schedule_match_proposals` (下書き→公開ワークフロー)
- `KoushuPlacementPanel` 手動配置UI (後に F-5 で `course_prep_periods` ベースに移行)

### Phase 5 (7cabe4b) — ロール別ビュー (P4 飛ばしてここ)
- `/my-schedule` 講師向け週/月切替+出欠記録 (隠し公開)
- `transfer_notifications` テーブル + `/schedule/transfer-notifications` 履歴画面 (Edge Function 送信は将来)
- `/portal/[schoolCode]/student-dashboard` 生徒/保護者ダッシュボード (擬似認証)

### Polish (d7a7b94, 28bc712)
- デザイントークン統一 (indigo→info、amber→warning、red→danger、green→success、紫→ink)
- Emil Kowalski 流 (active:scale, custom easing, stagger, prefers-reduced-motion)

### F ラウンド (25d34a8, e64a26a, b402b3b, 58d78d8) — UX修正
- F-1: `schedule_entries.teacher_id` nullable + 担当未決定でも生成
- F-2: 担当未決定セルを破線+warning色で表示 (`UNASSIGNED_TEACHER_ID`)
- F-3: 初期ロード時の「コマ時間未設定」誤発火修正 (`bootstrapped` フラグ)
- F-4: 通常シフト → 出勤可能講師を曜日別に自動表示
- F-5: 講習を `course_prep_periods` 期間ベースに移行 (`/courses` から切離し)
- 生徒カードに学年表示 (中2 等)、空コマアコーディオン折りたたみ

### G ラウンド (5940511, 7a40021, 949ac54) — 講師×シフト×マッチング
- G-1: `regular_shift_settings` に `effective_from / effective_until` 追加
- G-2: 期間考慮の統合API (`teacher-shifts.ts` の `getCurrentTeacherShifts` / `getSingleTeacherShift` / `getTeacherShiftHistory`)
- G-3: **通塾日程 × 講師マッチング画面** `/schedule/regular-patterns/match` (スコア式半自動)
- G-4: 講師詳細ページに「勤務シフト現在有効」「シフト提出履歴」パネル

---

## 4. 設計の落とし穴・注意点

### a. teacher_id NULL を許容している
- 通塾日程パターン (484/495件) が teacher_id NULL のままで実運用中
- 生成された schedule_entries も teacher_id NULL のまま座席表に表示
- 「担当未決定」エリアとして破線warning色でグルーピング (`UNASSIGNED_TEACHER_ID = '__unassigned__'`)
- マッチング画面で teacher_id を埋めると、未来エントリも一括で更新される (`assignTeacherToPattern` の `updateFutureEntriesOnly`)

### b. シフト提出は `user_id` 紐付けなし
- 既存 `regular_shift_submissions.user_id` は 0/全件で未設定
- そのため **`teacher_email` <-> `user_profiles.email`** で逆引きする方針で統一
- メアド不一致だとマッチしない (座席表自動講師カード・マッチング候補 どちらにも出ない)
- 将来は user_id を直接紐付ける仕組みに置き換え推奨

### c. 講習の「期間」と「プラン」は分離
- 期間 = `course_prep_periods` (春期/夏期/冬期 × 年 × 校 → start/end_date)
- プラン = `seasonal_courses` (course_id × season × ...) + `koushu_enrollments` (生徒×コマ数×科目)
- 座席表は **期間ベース** で動く。`KoushuPlacementPanel` は `KoushuPeriodInfo` を受け取る
- `getKoushuPlacementProgressByPeriod` が season + school で seasonal_courses を union して enrollments を集約

### d. マイグレ適用方法
- **MCP の `mcp__faa90072-..._apply_migration` を使う**（Supabase 公式 MCP）
- ローカル CLI (`supabase db push`) は履歴ズレで通らない (project: school-db に直接適用済み履歴が多数)
- 過去に作った `scripts/apply-pending-migrations.mjs` は削除済み (MCP に移行)
- `scripts/verify-phase0-migrations.mjs` は適用確認用に残してある

### e. 振替期限 / 振替通知
- 振替確定 (`createTransferEntry`) で `transfer_deadline = 元授業日の翌月末日` 自動セット
- 同時に `transfer_notifications` に pending レコード INSERT
- 実送信は将来 Edge Function 想定。今は履歴ページ `/schedule/transfer-notifications` で室長が手動「送信済みマーク」
- メアドが students に無い (parent_email カラム不在) → 送信先解決は要追加

### f. 講習概念のミスマッチがあった (F-5 で修正済み)
- P3-3 の初版は `seasonal_courses.start_date/end_date` を期間として使っていた
- ユーザー指摘: `seasonal_courses` は **生徒別プラン**で日程関係なし
- 修正後: `course_prep_periods` が期間の正のソース、`seasonal_courses` は座席表から完全切り離し

### g. RLS は permissive
- 全テーブル `FOR ALL TO authenticated USING (true) WITH CHECK (true)` で運用
- 本番リリース前に最小権限化が必要

---

## 5. 主要なファイル早見表

### マイグレーション (適用済み)
- `supabase/migrations/20260525_schedule_entries_kind_formation.sql` — kind/formation
- `supabase/migrations/20260525_regular_patterns_formation.sql`
- `supabase/migrations/20260525_time_slots_formation.sql`
- `supabase/migrations/20260525_students_teacher_preferences.sql`
- `supabase/migrations/20260525_school_class_capacity.sql`
- `supabase/migrations/20260523_schedule_versioning.sql`
- `supabase/migrations/20260525_schedule_daily_booth_assignments.sql`
- `supabase/migrations/20260525_schedule_entries_transfer_deadline.sql`
- `supabase/migrations/20260525_class_reports.sql`
- MCP 経由で適用済 (ファイルなし): `seasonal_shift_student_submissions`, `schedule_match_proposals`, `transfer_notifications`, `schedule_entries_teacher_id_nullable`, `regular_shift_settings_effective_period`

### API
| ファイル | 役割 |
|---|---|
| `src/lib/api/schedule.ts` | 座席表 CRUD・通塾日程・振替・ドリフト検知 |
| `src/lib/api/school-class-capacity.ts` | 授業生徒数設定 |
| `src/lib/api/class-reports.ts` | 授業報告書 CRUD + 督促 |
| `src/lib/api/teacher-shifts.ts` | **講師シフト統合 (G-2)**: 期間付き / 通常+講習 union |
| `src/lib/api/pattern-matching.ts` | **マッチング (G-3)**: 候補スコアリング + 割当 |
| `src/lib/api/koushu-period.ts` | 講習期間ベースの集約 (F-5) |
| `src/lib/api/seasonal-shift-student.ts` | 生徒版講習シフト |
| `src/lib/api/schedule-match.ts` | 自動マッチング提案 (P3-2、未活用) |
| `src/lib/api/schedule-daily-booth.ts` | ブース番号 |
| `src/lib/api/schedule-vs-attendance.ts` | 勤怠チェック比較 |
| `src/lib/api/transfer-notifications.ts` | 振替通知履歴 |

### 主要画面
| パス | 内容 |
|---|---|
| `/schedule` | 座席表メイン (週/日切替、講習選択、ドリフト警告、督促ボード、マッチングモード) |
| `/schedule/regular-patterns` | 通塾日程一覧 (生徒×曜日×コマ) |
| `/schedule/regular-patterns/match` | **G-3 マッチング画面** |
| `/schedule/transfer-notifications` | 振替通知履歴 |
| `/schedule/settings/time-slots` | コマ時間設定 |
| `/schedule/settings/closed-days` | 休講日 |
| `/settings/class-capacity` | 授業生徒数設定 |
| `/lesson-reports/[scheduleEntryId]` | 授業報告書フォーム |
| `/lesson-reports/pending` | 報告書承認 |
| `/lesson-reports/overdue` | 報告書督促 |
| `/students/[id]/lesson-reports` | 過去報告書 |
| `/today` | 本日の授業 (講師/室長) |
| `/my-schedule` | 講師向け週/月スケジュール (隠し公開) |
| `/seasonal-shift-student/[settingId]` | 生徒の通塾可能表 公開フォーム |
| `/portal/[schoolCode]/student-dashboard` | 保護者ダッシュボード (擬似認証) |
| `/admin/teachers/[teacherId]` | 講師詳細 (G-4 で勤務シフト+履歴パネル追加) |

### 主要コンポーネント
- `src/components/schedule/WeeklyScheduleGrid.tsx` / `WeeklyScheduleGridView.tsx` — 座席表本体
- `src/components/schedule/TeacherCard.tsx` — 講師ブロック (担当未決定 styling 込み)
- `src/components/schedule/StudentCard.tsx` — 生徒カード (学年表示)
- `src/components/schedule/ScheduleCell.tsx` — セル (振替期限チップ)
- `src/components/schedule/PendingTransfersBoard.tsx` — 期限切れ督促ボード
- `src/components/schedule/BoothAssignmentModal.tsx` — ブース番号設定
- `src/components/schedule/KoushuPlacementPanel.tsx` — 講習配置パネル (period ベース)
- `src/components/schedule/ScheduleDriftBanner.tsx` — ドリフト警告
- `src/components/attendance/ScheduleDriftCheckPanel.tsx` — 勤怠チェック

### モック資料
- `docs/mockups/schedule-matching-v3.html` — 座席表マッチングモード (週表示版)
- `docs/mockups/student-view-v3.html` — 生徒ダッシュボード
- `docs/mockups/lesson-report-v3.html` — 授業報告書フォーム
- `.impeccable.md` — NEST デザインコンテキスト (これに合わせて polish 済)

---

## 6. 残課題 / 次のラウンドで検討すること

### 短期 (運用すぐ困りそう)
1. **マッチング画面の使い込み**: 415件/266生徒 を実際に進める。「候補1人のみ即決」フィルタで一気に潰せるか検証
2. **`getPatternMatchCandidates` のスコア調整**: 実運用してみてスコア基準が現場感と合うか (担当固定 +50 / 過去 +30 等)
3. **座席表で「同一講師が同時刻に複数生徒」表示の整理**: 1講師セルの中で生徒2人を見やすく
4. **`/today` ページの「報告書を書く」フロー**: 講師が動線通りに動けるか動作確認

### 中期 (機能追加候補)
5. **Phase 4 マッチング本体 (未着手)**: schedule_match_proposals の自動生成アルゴリズム。半自動 G-3 で十分か、自動化に進むか判断
6. **生徒アカウント整備**: portal の擬似認証→本物のサインインベースに移行
7. **振替通知の Edge Function 実装**: `transfer_notifications` の pending を拾ってメール/LINE 送信
8. **報告書 AI 下書き**: テスト結果+進行表データから自動生成 (UI placeholder 配置済み)
9. **勤怠チェックでの attendance_type マッピング設定**: 現在は単純合算だけ。「通常授業」「特別講習」と attendance_type を学校別にマッピング
10. **集団授業の簡易報告書** (現在は個別のみ)

### 長期 (見送り中の方針判断)
- 講習のグループ概念を本格導入するか (Q3 で「クラスは作らない」と決めたが、将来 group_id でまとめるか?)
- 振替期限切れの自動キャンセル処理
- 通塾日程「指定日から変更」のUI改善

### 既知の問題
- Vercel build が依存解決で時間かかる (重要じゃない warning が大量)
- `regular_shift_submissions.user_id` を埋める仕組みがない (email マッチで誤魔化し中)
- mockup ファイル (`docs/mockups/*.html`) は古い版もそのままある → 整理してもいい

---

## 7. デバッグ・操作のコツ

### マイグレーション適用
```
ToolSearch で mcp__faa90072-* を呼んで apply_migration を使う
project_id: mzxysqkuuxcfffwlfsvj
```

### スキーマ確認
```sql
-- via mcp__faa90072-..._execute_sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='schedule_entries';
```

### 検証スクリプト
```bash
node scripts/verify-phase0-migrations.mjs
```

### 動作確認手順 (代表シナリオ)
1. `/schedule` 開く → 担当未決定エントリが破線で並ぶ
2. ドリフトバナーの「反映する」→ 通塾日程→座席表の不整合を解消
3. `/schedule/regular-patterns/match` でフィルタ「候補1人のみ」→ 一気に割当
4. 講師詳細 (`/admin/teachers/[id]`) で「勤務シフト現在有効」を確認
5. 振替を1件作る → `/schedule/transfer-notifications` に pending が出る

---

## 8. 連絡先・参照

- ユーザー: ytaka1452 (tybiz1452@gmail.com)
- Vercel project: `school-db` (org: schoolie-nagayama-tech)
- Supabase project: `mzxysqkuuxcfffwlfsvj`
- 言語: 日本語で応答する設定 (memory/MEMORY.md 参照)
- デザイン原則: `.impeccable.md` (NEST の Quiet Modern Tool 路線)
- 絵文字禁止: コード/UI内では装飾的絵文字を使わない (lucide-react アイコン)

---

---

# 【セッション2 追記】H〜O ラウンド（2026-05-28）

> G-4 以降に実施した大量の機能追加・UX改善・バグ修正。次の会話はここを最優先で読むこと。

## ★ 最重要：講習の認識（ユーザーと確定済み）

**ここを間違えると全部ズレる。** 講習の本質は以下:

| 要素 | 正 |
|---|---|
| 講習期間 | `course_prep_periods`（春/夏/冬 × 年 × 校）。**全生徒統一**。コース個別の期間は無意味 |
| 生徒の申込 | `koushu_enrollments`（生徒×科目×コマ数）が**唯一の入力源**。座席表はこれだけ見る |
| コース (`seasonal_courses`) | 「科目×コマ数」の**単なるテンプレ**。使わない生徒もいる/組合せる/適用後カスタムで跡形なく変わる。**無くても講習は成立**。スケジュールに無関係 |
| 座席表の講習配置 | 申込コマ数を期間内の枠に**消化配置**（残コマ管理）。テンプレ由来かは一切関係ない |

- `/schedule/koushu` は「**講習コース**」にリネーム済（旧「講習管理」）。テンプレ置き場。全体ナビからのみアクセス
- 座席表「講習」ボタン = 座席表内の講習モード切替。期間未設定時は `/courses/progress`（講習期間設定）へ誘導
- ユーザー提示の講習モードUI見本: `docs/mockups/schedule-matching-v3.html`（mode-toggle + 個別/集団レーン）

### コース起点の2系統分離（ユーザー確定 2026-05-29「別軸で正しい」）

講習コース (`seasonal_courses`) は「**内容のテンプレ**」。起点から**全く別の2系統**に分岐する。混同するとズレる:

```
                        ┌─ ①適用 (applyCoursesToStudents)
                        │     → student_textbooks / 提案書・進行表
   講習コース           │     = 「何を勉強するか」(内容)
 (seasonal_courses) ────┤        ※座席表には出ない。現役データ(夏期128名)はこっち
   = 内容のテンプレ      │
                        └─ ②申込 (koushu_enrollments・手入力)
                              → 座席表 schedule_entries(kind=koushu)
                              = 「何コマ座るか」(コマ数)・現在0件
```

| 系統 | 入口 | 書込先 | 意味 |
|---|---|---|---|
| **①適用＝内容** | `/courses/[courseId]/apply`・`LegacyProgressPage` | `seasonal_course_applications` + `student_textbooks` + 提案書/進行表 | 何を勉強するか（教材・単元）。**座席表に出ない** |
| **②申込＝コマ数** | `/schedule/koushu` の申込モーダル（手入力） | `koushu_enrollments` → 座席表 `schedule_entries(kind=koushu)` | 何コマ座るか。コマ数は `course.total_koma` とは別の手入力値 |

- 「コース適用128名 vs 申込0件」は**矛盾ではなく別軸**。適用＝内容、申込＝コマ数。
- 座席表のコマ数は**コースの `total_koma` とは無関係**な手入力値。
- 申込スコープは season のみで year を見ていない（`seasonal_courses` に year 列なし）。今は夏期2026のみ＋`is_active=true` で実質回避。翌年セットアップ時に旧年度コースを `is_active=false` にする運用が前提（latent な「来年問題」）。
- 検証データ実態(2026-05-29): `seasonal_courses` 907件 / `seasonal_course_applications` 456件 / `koushu_enrollments` 0件 / `schedule_entries kind=koushu` 0件。

## このセッションで追加した新規テーブル（MCP適用済・リポジトリにマイグレファイル無し）

- `teacher_availability_periods` — 講師の出勤可能期間（期間バージョン管理）。`source` = manual / regular_shift。リード優先順位 manual > regular_shift
- `schedule_change_logs` — 担当変更履歴ログ（assign/reassign/transfer 等）
- `teacher_absences` — 講師の欠勤（コマ単位。user×date×time_slot UNIQUE）

## 新規 API ファイル

- `src/lib/api/teacher-availability.ts` — 出勤可能期間。`syncRegularShiftToAvailability` / `getAvailabilityDayMap` / `getEffectiveAvailability` / `upsertManualAvailability` 等
- `src/lib/api/schedule-change-logs.ts` — 変更履歴の記録/取得
- `src/lib/api/teacher-absences.ts` — 欠勤の mark/unmark/取得
- `src/components/lesson-reports/DemoProgressPreview.tsx` — 報告書見本下の進行表イメージ（共通）

## ラウンド別サマリ

### H：通常シフト → 出勤可能期間の自動反映
- 通常シフト提出 (POST/PUT/DELETE/setting更新) で `teacher_availability_periods` に自動 upsert
- 「3月に希望取って4月から反映」を期間 (effective_from/until) で管理
- 講師詳細 `/admin/teachers/[id]` に「出勤可能期間」パネル（現在/今後/過去 + 追加/編集/再同期）
- 講師編集の保存も manual period を並行 upsert
- 座席表・マッチングを `getAvailabilityDayMap` 経由に切替（旧 getCurrentTeacherShifts はフォールバック）

### I：座席表D&D + マッチング画面改善
- 「出勤可能講師カード」「未配置生徒」を講師セルにD&D → floating bar「このコマだけ/毎週このコマ」
- マッチング画面: AdminLayout化・科目チップ・スコア凡例・「全候補N名」モーダル・/schedule から導線バナー
- D&D の識別子区切りを `|`→`:` に（`__unassigned__:<entryId>`。teacher-slot ID が3パーツ `date|slot|teacher` のため）

### J
- 振替の月内回数制限：生徒の通塾日程パターン数（週N回）= 月N回上限。超過は警告 →「もう一度」で実行 (`getMonthlyTransferUsage`)
- 日次印刷を A4縦・2列レイアウトに刷新（`ScheduleDailyPrintView`）

### K
- D&D 制約チェック（ハード）：講師の指導可能科目 / 生徒の希望性別 / 除外指定。違反はドロップ拒否 + 赤バッジ。マッチングも同制約で候補除外
- ドラッグ中ハイライト：可能セル emerald ring、不可セル opacity+grayscale
- 講師カードのミニラベル（性別 M/F・指導科目チップ）
- 担当変更履歴ログ `/schedule/change-logs`

### L
- 1日セルを **1列に戻した**（2列は生徒名が読めず却下）
- 未配置エントリは **各 DayCell の下部に「未配置」チップ**で表示（セル単位、`unassignedEntries` props）。座席表上部の集約プールは廃止

### M
- スケジュール機能の権限を**教室長以上 (admin/owner/manager) で統一**。入口は未公開（URL直共有）。`/schedule/koushu` にガード追加
- 座席表右上に「講習」「報告書見本」ボタン
- 未配置ありコマは折りたたまない + 時間ラベル下に「未配置N」バッジ
- 割当を**当日から有効**に（JST today = `toLocaleDateString('en-CA',{timeZone:'Asia/Tokyo'})`）。再割当(A→B)も反映
- `generateWeeklySchedule` の再生成carry：既存の手動割当 teacher_id を退避して引き継ぎ（「このコマだけ」が消えるバグ修正）

### N
- **focus/visibilitychange の自動 refreshEntries を撤去**（「定期的に再読み込みで描画が重い」対応）。更新は再取得ボタン/週切替で
- 講師✕で生徒0人でも emptyTeacherSlots に追加してグレーアウト維持
- 「毎週このコマ」で A→B 変更時は**期間分割** (`reassignTeacherFromToday`)：旧パターンを前日締め + 新パターンを当日から作成 + 当日以降エントリ付替え。未配置→割当は単純上書き
- 移動→振替→戻すで生徒2重バグ修正：drift の actual に transferred_out 含む + generateWeeklySchedule で transferred系の枠スキップ
- 割当確定バーにスプリング登場アニメ（globals.css `assign-bar-enter`）

### O
- 講師欠勤機能（コマ単位）：講師カード右上の人型トグル、欠勤は赤斜線+「欠勤」バッジ。生徒は自動で動かさない
- 報告書見本 `/lesson-reports/sample`：3タブ「入力画面（講師）/完成イメージ（室長）/保護者の見え方」
- `/lesson-reports/demo`：**実フォームをダミーデータで開くモード**（`scheduleEntryId==='demo'`、保存無効）
- 学校進度を**選択式**（教材カリキュラム単元の select）に。進行表 (schoolProgressUnits) 同期前提
- 宿題日付を等分配 → **授業翌日から次回授業日まで連番自動**
- 報告書の下に進行表イメージ（`DemoProgressPreview`）を講師入力画面・室長確認の両方で表示
- `/lesson-reports/pending` にヘッダー + 座席表へ戻るボタン

### P/U/K/M/N：講習（季節講習）モード 本実装ラウンド（2026-05〜06）
> プラン `sleepy-dazzling-truffle.md`（個別＋集団 / 下書き→公開 / 個別は自動マッチング・集団は手動）に沿って実装。コミット deaa3f5・dee14ba・d172d48・51aa816 ほか。

**P1 データ基盤**
- `koushu_enrollments` に `formation`(individual/group) 列追加。後に**期間ベース化**（`school_id`+`season` 列追加・`course_id` nullable・UNIQUE を `(school_id,season,student_id,formation)` に）。コース依存を廃止し「春期/夏期/冬期 × 校 × 生徒」で申込を持つ
- さらに `koma_by_subject`(jsonb) 追加で**科目別コマ数**を保持（M4）
- capacity ハードコード（1講師2名・12席）を `school_class_capacity` 読込に置換
- `/settings/time-slots` に個別/集団 formation トグル → 集団コマ時間を別建て設定可能に
- `generateWeeklySchedule` の週次 DELETE に `.eq('kind','regular')` を追加（**通塾日程の再生成で講習コマが消えるバグを予防**）

**P2 個別の自動マッチング + 下書き公開**
- 新規 `src/lib/api/koushu-match.ts`：`generateKoushuIndividualProposals`。**加重和スコア × 貪欲割当**（残コマ多い順、同一科目を均等分散、1生徒1日のコマ上限）。重みは `MATCH_CONFIG`（**全て暫定値**、冒頭に集約）。teacher_id NOT NULL のため候補講師ゼロの枠は提案を作らず unmatched に積む
- (student,subject) 単位でタスク化し、提案は単一科目を持つ
- 既存 `schedule-match.ts`（batch/proposal/publish）をそのまま再利用。下書き → 個別公開/全公開/却下

**P3 集団レーン + 集団手動配置**
- 講習モードで entries/timeSlots を formation 分割し**個別レーン（既存グリッド）＋集団レーン（新規 `GroupLaneGrid`）の2段**描画
- `GroupCard`（1講師＋最大N名）/`GroupKomaFormModal`（日付・集団slot・科目・講師・生徒複数で一括作成）。`createScheduleEntry` は formation='group' 時に講師重複チェックをスキップ（1講師が複数の集団生徒を持つため）
- 容量ガード（max_students_per_group / max_concurrent_groups）

**U（高優先 polish）**：デザイントークン統一（info/warning/danger/success） / 未マッチを生徒名つきで詳細表示 / 下書きを座席表に★（仮）チップ表示（placed に二重計上しない）

**K（手動落とし込み強化）**：講習モードで**期間の週へ自動ジャンプ** / 空きセルクリックで配置 / 配置モード中はその生徒の**通塾可能セルを色付け** / 落とし込めない時は**理由を明示**（過去日・席満杯・講師上限・生徒重複・対象外科目 等）

**M（操作性）**：M1 週移動の左右縦長アイコン / M2 自動マッチング下書きの色を区別（点線・info） / M3 生徒名クリックで通塾日程＋申込コマ数を展開 / M4 申込を**科目別コマ数**に拡張 / M5 出勤可能講師カードクリックで配置

**N（情報設計の再編）**
- 座席表ヘッダーの「講習」トグルボタンを**削除**（操作はツールバーの講習期間 select に集約）
- `/schedule/koushu` を **「講習 申込（生徒別）」画面**に作り替え：期間タブ → 生徒行ごとに科目×個別/集団のコマ数を入力/閲覧、通塾日程の展開、追加/編集/削除。`KoushuEnrollmentFormModal` は科目×個別/集団のマトリクス入力に刷新（個別コマの初期値に「講習期間中の通常授業回数」概算を表示）

**バグ修正（座席への担当割当）**：`updateScheduleEntry` を1回リトライ＋実DBエラーをメッセージに表出。割当確定の catch で `refreshEntries()` し UI を自己修復（DB 側 UPDATE は RLS 下で成功することを SQL インパーソネートで確認済み＝クライアント側の一過性エラーだった）

**RLS 是正**：`course_prep_*` 6テーブルの RLS を `check_school_access()` に統一（システム管理者＝全校 admin が `user_schools` 未所属でも参照可、anon はブロック維持）。これで講習モードのリスト取得が空になる回帰を解消

### 追加授業（単発コマ）＋ ズレ自動反映（2026-06-02）
**ズレ自動反映**：`ScheduleDriftBanner` を「検知したら自動で反映」に変更（`autoResync` 既定 true）。今週から先4週のズレを開いたタイミングで自動再生成。自動中は青バナー、失敗時のみ従来の手動「反映する」にフォールバック。`onResynced=refreshEntries` 配線。

**追加授業**：`schedule_entries.kind` に `test_prep`(テスト対策)/`additional`(追加授業)/`trial`(体験) を追加（マイグレ `20260602_schedule_entries_kind_extra_types.sql`、CHECK 拡張）。
- 通塾日程を持たない単発コマ（`regular_pattern_id=NULL`）。`generateWeeklySchedule` のスキップ条件を `kind.eq.koushu`→`kind.neq.regular` に変えて**追加授業も再生成で消えないよう保護**。ドリフト判定は `regular_pattern_id IS NOT NULL` で絞っているので追加授業は対象外（ズレに出ない）。
- 入力：座席表の講師カード空き枠クリック → `AddStudentToSlotModal` の「この日のみ追加」で**種別セレクト**（追加授業/テスト対策/体験/臨時）→ `createScheduleEntry(form.kind=種別)`。
- 表示：`StudentCard` に種別バッジ（テスト対策=warning / 追加授業=ink / 体験=success トークン色）。`isExtraLessonKind()` / `EXTRA_LESSON_KINDS`（types/schedule.ts）。
- **残**：単発配置(追加授業/体験)の請求(カウント)連動は未実装。体験は生徒を先に登録しておく必要あり（既存生徒検索のため）。

### テスト対策（増コマ）の座席表落とし込み（2026-06-02）
講習と同じ要領で、増コマ(zoukoma)フォーム回答を正典に「テスト対策」コマ(kind='test_prep')を座席表へ落とし込む。
- **データソース**: `form_responses`(form_type='zoukoma', `linked_student_id` 紐付け済み)。専用テーブルは作らない。科目はフォームの**名前キー**→Subjマスタへ**名前一致**。通塾枠は `response_data.selected_slots`（"YYYY-MM-DD_時限コード"）。時限の開始時刻は `form_periods.settings.schedule.periods`。
- **API** `src/lib/api/zoukoma-placement.ts`: `getZoukomaPlacementPeriods` / `getZoukomaPlacementProgress`（生徒×科目の enrolled/placed＋通塾可能枠）。
- **配置**: `createTestPrepPlacement`（`createKoushuPlacement` を kind パラメータ化して共通化）。担当未決定で配置→後でドラッグ割当。
- **座席表**: 追加授業モード（講習と**排他**）。ツールバー「テスト対策」期間セレクト＋「追加授業設定」リンク。上部に `TestPrepPlacementPanel`。配置モードで**通塾可能セルを強調**（時限→time_slot は start_time 一致でマップ、不可なら日単位フォールバック）→クリックで配置。配置プロップは講習/テスト対策を `gridPlacing/gridGetPlaceability/gridPlace/gridPlaceWithTeacher` で一本化。
- **登録画面** `/schedule/zoukoma`（生徒別 増コマ申込）: 科目×コマ数＋通塾できる枠を登録＝`linked_student_id` 付き form_response を作成/更新（`ZoukomaEnrollmentFormModal`。SubjectInput/SlotTable(available)/StudentSearchInput を再利用）。削除は `archiveResponse`。
- **RLS**: `form_responses` は authenticated に `check_school_access(school_id)` で ALL 許可 → 管理者の作成/紐付け/アーカイブは通ること確認済み。請求計上は増コマ既存フロー（回答一覧の「計上」）を流用。

## ★ 重要バグ修正：「スケジュールの取得に失敗」
- 原因：`generateWeeklySchedule` の再生成 INSERT が UNIQUE 制約
  `(school_id, entry_date, time_slot_id, teacher_id, student_id)` 違反
- DELETE は `status IN ('scheduled','completed')` のみ消す → 残った **cancelled / transferred系** の行と同キーを INSERT して衝突
- 修正：生成スキップ対象 (`transferredKeys`) に `transferred_out / transferred_in / cancelled` の (date-slot-student) を全部含める（`src/lib/api/schedule.ts`）
- **教訓**：generateWeeklySchedule は週全削除→再INSERT。DELETE 対象外ステータスの枠は必ず生成スキップすること

## 残課題（次のラウンドで詰める）

### 最優先
1. ~~**講習モードの中身を enrollment 基準に**~~ → **完了**（P/U/K/M/N ラウンド）。申込は `koushu_enrollments` を「校×season×生徒×formation×科目別コマ」で持ち、座席表は残コマ消化モデル。個別は自動マッチング下書き、集団は手動編成。残作業の候補：実運用しながら `MATCH_CONFIG` の重み調整 / 集団マッチングの軽量自動化
2. **報告書 × 進行表のマージ本実装**：現状はダミーイメージ (`DemoProgressPreview`) のみ。合意済みゴール = 「**入力1つ・ビュー2つ**（講師/室長向け進行表ビュー + 保護者向け報告書ビュー）」。重複項目（学校進度・単元・講師コメント）の一本化が前提。`progress_sessions.report_id` で紐付け基盤あり

### 中期
3. 学校進度の進行表との**真の双方向同期**：`class_reports` に `school_progress_curriculum_id` 追加 + 進行表 schoolProgressUnits への転記
4. `seasonal_courses.start_date/end_date` は未使用 → クリーンアップ候補（今は放置で害なし）
5. `regular_shift_submissions.user_id` 未設定問題は残る（email マッチで誤魔化し中）

### 講習マッチングのアルゴリズム改善（やってみないと分からないので段階的に。詳細メモ: memory/project_koushu_matching.md）
`src/lib/api/koushu-match.ts` は現状「**加重和スコア × 貪欲割当**」。決定は2軸（①1マスのスコア付け ②全体の割当戦略）。出力は人がレビューする下書きなので**透明性重視**。
- **スコア(①)**: 加重和を維持（`MATCH_CONFIG.weights` は暫定値）。0-1正規化はしておくと重みの意味が安定。
- **割当(②)** を費用対効果順に改善:
  1. **安価改善（貪欲のまま）**: 生徒の並びを「残コマ多い順」→「**候補講師が少ない順=制約の強い順**」＋**未マッチを後からリペア（入替え）1パス**。
  2. **最小費用流 / 二部マッチング最適化**: 席数・1講師上限を容量に総スコア最大。外部依存なしで実装可。
  3. **CP-SAT/ILP（OR-Tools）**: 均等配置・公平性まで厳密最適化。とことんやる場合（依存・実行時間・Vercel実行を要検討）。
- 安定マッチング(Gale-Shapley)は講師側に選好が無いので不向き。A/B比較用に別関数で用意するのも可。

## デバッグ Tips（追記）
- Supabase エラーログ：`mcp__faa90072-..._get_logs` で `service: 'postgres'` → 直近24hのエラー（UNIQUE違反等）
- 制約確認：`SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='schedule_entries'::regclass`
- 重複検出：`GROUP BY entry_date, time_slot_id, student_id HAVING COUNT(*)>1`
- JST「今日」：必ず `toLocaleDateString('en-CA',{timeZone:'Asia/Tokyo'})`。`toISOString().slice(0,10)` は UTC でズレる

## Vercel / リポジトリ
- リモート: `github.com/schoolie-nagayama-tech/school-management` (main)
- 講習本実装ラウンド（deaa3f5・dee14ba・d172d48・51aa816 ほか）まで全て push 済み
- 型チェックは `npx tsc --noEmit`（このプロジェクトは @typescript-eslint/no-unused-vars が error）

---

_最終更新: 2026-06-02 / 講習（季節講習）モード本実装（P/U/K/M/N ラウンド）+ 担当割当の耐性化 + course_prep RLS 是正 完了時点。テスト申込データは片付け済み_
