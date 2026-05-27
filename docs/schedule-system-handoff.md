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

_最終更新: 2026-05-27 / G-4 完了時点_
