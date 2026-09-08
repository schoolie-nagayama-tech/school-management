# 講習進捗管理表 スナップショット計画

作成: 2026-09-04 / 状態: Phase 1〜8 実装済み・実機未検証。本番DB適用済み（`course_prep_snapshots` 2026-09-04 / 通塾パターンの `effective_until` 埋め戻し 2026-09-07）。
**Phase 8（講習期間の区分）のマイグレーション `20260908120000_course_prep_tracks.sql` は本番未適用。**

## 1. 何が問題か

`/courses/progress` の進捗管理表とダッシュボードは、**表示のたびに現在のライブデータから全数字を再計算している**。
保存されているのは手入力セル（`course_prep_student_progress`）と列定義（`course_prep_progress_items`）だけで、
集計に効く入力の大半は「今の値」を読みにいく。

そのため講習期間が終わったあとも、過去の期の数字が動き続ける。

| 動く原因 | 該当箇所 | 何が起きるか |
| --- | --- | --- |
| 生徒一覧が `status != 'withdrawn'` | `api/courses/prep/route.ts` 生徒取得 | 退塾した瞬間に行ごと消え、その生徒のコマ数が実績から抜ける |
| `regular_weekly` / `course_sessions` が現在の `schedule_regular_patterns`（`is_active = true`）から計算 | 同 `auto_values` | 次の期に通塾パターンを組み替えると、過去の期の週回数・コマ数まで書き換わる |
| `course_sessions` が `course_prep_periods.schedule_start/end_date` に依存 | 同 | 期間日付を直すと過去のコマ数が変わる |
| 提案・取得コマが現在の提案書から再計算 | `fetchSubjectProposals` | 提案書を消す・直すと過去の提案／取得実績が変わる |
| 学年が生徒レコードの現在値 | 生徒取得 | 学年別の内訳が翌年ずれる |

とくに退塾は日次 cron（[[生徒_退塾日→ステータス自動切替]]）で退塾日の翌日に `withdrawn` へ切り替わるため、
**8/31 退塾 → 9/1 に夏期講習の実績から消える**。年度末に前年を振り返ろうとしても、
残っているのは「今も在籍している生徒だけの夏期」になっていて、実績にならない。

## 2. 方針

**集計結果ではなく、集計の入力を凍結する。**

集計は `computeDashboardAggregates(students, items, progressData, autoValues, period, today)` という純関数に一元化済み
（`src/lib/coursePrepKpis.ts`、[[講習_進捗レポート印刷＋集計一元化]]）。
この引数5点セットをそのまま保存すれば、表・ダッシュボード・A3レポート・全校サマリーを**一切改造せずに**当時の姿で再生できる。

原則を2つ置く。

1. **保存するのは入力だけ。計算は常に現行ロジックで行う。**
   集計結果を焼き付けない。定義を直したときに過去も新定義で見えるので、年度間比較で定義が揃う。
   一覧用の `summary` はキャッシュであって正典ではない（payload からいつでも再生成する）。
2. **凍結の前に、ライブ側が勝手に痩せないようにする。**
   スナップショットを取り忘れた期が復元不能になるのを避けるため、退塾しても期間中の在籍者は消さない。

## 3. 実装

### Phase 1: 退塾しても消えないようにする（ライブ側の修正）

生徒取得の条件を「退塾していない」から「**この講習期間中に在籍していた**」に変える。

- 判定: `status != 'withdrawn'` **または** `withdrawal_date >= 講習期間の開始日`
- 開始日は `course_prep_periods.schedule_start_date` を使う。
- **期間未設定（`schedule_start_date` が null）のときは従来どおり退塾者を除外する。**
  在籍していたか判定する根拠がないため。期を作るときに期間を入れてもらう運用で担保する。
- **`status = 'withdrawn'` なのに `withdrawal_date` が null の生徒は除外する。**
  在籍していた証拠がないので、混ぜない側に倒す。
- 表では退塾者に「退塾」バッジを付け、行を薄くする（今いる生徒と混ざらないように）。

工程表タスクの進捗率の母数も同じ生徒集合に揃える。
（現状 `runBatchForSchool` 内の母数だけ `withdrawn` を除外し、`schedule_tasks` 側の2か所は除外していない不整合がある。共通ヘルパーに寄せる。）

### Phase 2: スナップショットの保存

新テーブル1本。子テーブルには割らない（凍結物であり、セル単位で引くことがないため）。
JSONB 1行にまとめることで [[落とし穴_PostgRESTの1000行上限]] も踏まない。

```sql
create table course_prep_snapshots (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references schools(id) on delete cascade,
  season         text not null,
  year           integer not null,
  payload        jsonb not null,   -- 集計の入力を凍結したもの（正典）
  summary        jsonb,            -- 一覧表示用キャッシュ。payload から再生成可
  student_count  integer not null default 0,
  captured_at    timestamptz not null default now(),
  captured_by    uuid references auth.users(id),
  capture_reason text not null default 'manual',  -- 'manual' | 'auto'
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (school_id, season, year)
);
```

`payload` の形（`version` で将来の形式変更に備える）:

```jsonc
{
  "version": 1,
  "students":   [ /* id, school_id, grade, 氏名, かな, status, withdrawal_date のみ */ ],
  "items":      [ /* CourseProgressItem 全件（非表示列も含む） */ ],
  "progress":   [ /* StudentCourseProgress。対象生徒 × 対象列のみ */ ],
  "autoValues": { /* AutoValues をそのまま */ },
  "period":     { /* CoursePrepPeriod をそのまま */ }
}
```

生徒は**全列を保存しない**。表示に要る項目だけを明示ホワイトリストで持つ
（住所・連絡先などを凍結物に増やさない）。

- 保存は `/api/courses/prep` に `action=save_snapshot` を追加（service role、教室長以上）。
- 取り直しは同じ行への upsert。`captured_at` でいつ時点かが分かる。
- 一覧は `action=list_snapshots`、復元は `action=get_snapshot`。

### Phase 3: 表示

新しい画面は作らない（[[構想_AI機能を既存画面に組み込む]] と同じ方針）。既存の `/courses/progress` に載せる。

- 期・年セレクタで**保存済みの期を選ぶと、自動でスナップショットを読んで表示**する。
- 上部に「◯年◯月◯日時点の確定データ」バッジ。**全編集を無効化**（読み取り専用）。
- 「最新のデータで見る」トグルで、その期のライブ表示にも切り替えられる。
- 未確定の期に「この期を確定保存」ボタン（教室長以上）。確定済みなら「取り直し」。
- **状態バーは期の途中には出さない**（2026-09-07）。
  期の途中に「まだ確定保存されていません」と出しても、まだ確定する時期ではないので飾りになる。
  期が終われば日次cronが翌朝に勝手に確定するので、普段は何も出さないのが正しい。出すのは:
  - 確定済みのとき（当時のデータか今のデータかは常に明示する必要がある）
  - 期間の終了日を過ぎているのに未確定のとき（自動確定の前後、または45日の自動確定枠を過ぎた古い期）

  終了日が未設定の期は「終わった」と判定できないのでバーが出ず、手動確定もできない。
  期間日付は退塾者の判定にも要るので、期を作るときに必ず入れる運用で担保する。
- 生徒名クリックの生徒詳細モーダルは、スナップショット表示中は開かない（凍結物と現在の生徒情報が混ざるため）。

### Phase 4: 自動確定

日次 cron で「最後の区分の終了日（`resolvePeriodLastEndDate`。Phase 6 → Phase 8 で区分ベースに）を過ぎていて、まだスナップショットが無い期」を
1回だけ保存する（`capture_reason='auto'`）。対象は終了から45日以内の期だけ（導入時に昔の痩せた期を確定として焼き付けないため）。
Phase 1 で退塾者が消えなくなっているので、退塾 cron との実行順に依存しない。

### Phase 5: 仕上げ

- `help/page.tsx` の `FAQ_DATA` を更新（[[進め方_機能変更時にヘルプ更新]]）。
- 夏期2026 を遡って確定保存する（Phase 1 適用後、退塾者が戻ってから）。

### Phase 6: 学年別終了日への対応（2026-09-07）

> **★ Phase 8（2026-09-08）で「区分」に置き換え、この節の実装は撤去した。**
> 同じ小6でも受験する子としない子がいるため、学年では割れなかったのが理由。
> 以下は経緯の記録として残す。`course_prep_periods.schedule_end_by_grade` の列自体は
> 既存データを消さないために残してあるが、期間の解決にはもう使わない。

冬期は学年で講習期間が違う（中3だけ入試直前まで続く）。この上書きは
`course_prep_periods.schedule_end_by_grade`（jsonb・学年番号の文字列 → `YYYY-MM-DD`）に入っていて、
入力は「設定 → 講習申込」の「学年別の講習終了日」（決定44）。未記載の学年は `schedule_end_date` に落ちる。

進捗表側は共通の `schedule_end_date` しか見ていなかったので、次の3か所を学年別終了日に合わせる。

| 何を | どこで | なぜ |
| --- | --- | --- |
| 通常回数（`course_sessions`）を生徒の学年の終了日で数える | `runBatchForSchool` の auto_values（`src/lib/server/coursePrepBatch.ts`） | 増コマ＝提案コマ−通常回数。中3の期間が長いのに共通終了日で数えると通常回数が少なく出て、**増コマが水増しされる** |
| 自動確定は「最後の学年が終わってから」 | `src/app/api/cron/finalize-course-prep/route.ts` | 中3がまだ講習中なのに凍結すると、そのあと入る中3の取得コマが実績から丸ごと落ちる |
| 状態バーの終了判定 | `hasPeriodEnded`（`src/app/courses/progress/page.tsx`） | 上と判定基準を揃える。中3が講習中の期に「終わっているのに未確定」と出すと誤って手動確定させてしまう |

- 判定の共通部品は純関数 `resolvePeriodLastEndDate(period)`（`src/lib/coursePrepKpis.ts`）。
  `schedule_end_date` と `schedule_end_by_grade` の値の最大を返す（`YYYY-MM-DD` 固定長なので辞書順比較、
  書式が違う値は無視）。cron は SQL では窓をかけず終了日のある期を全件取り、終了判定も45日窓も JS 側でこれに対して行う。
  **SQL で `schedule_end_date` に下限をかけてはいけない**: 共通1/7・中3が2/25 のような冬期では、中3が終わる頃に
  共通終了日が窓の外に出ていて、その期が永久に自動確定されなくなる。
- 通常回数の計算は `computeCourseSessionsForStudent(dayMap, dayCounts)` に切り出し、
  終了日ごとの曜日出現回数（`countDayOccurrences`）を終了日文字列でキャッシュして数え直しを避ける。
  学年は `students` から `id, grade` だけを遅延1回引く（`students` target は在籍フィルタで絞られていて使い回せない）。
- **退塾者を残す判定（Phase 1）は開始日だけを見るので影響を受けない。** 開始日は全学年共通。
- ダッシュボードの「講習期間」欄には、学年別の上書きがあるときだけ補足を出す（表示のみ・編集は設定側に一本化）。


### Phase 7: 通常回数を「その期に有効だったパターン」で数える（2026-09-07）

通常回数（`course_sessions`）を `schedule_regular_patterns.is_active = true` だけで数えていたため、
通塾パターンをいじるたびに**過去の期の数字が両方向に狂っていた**。

| 起きること | 影響 |
| --- | --- |
| 期の後にパターンを停止 | その期に通っていたのに数から消える → 通常回数↓ → **増コマが水増し** |
| 期の後にパターンを新設 | その期にまだ無いのに数えられる → 通常回数↑ → **増コマが過少** |
| 変更で締めた旧パターン（`effective_until` あり・`is_active` は true のまま） | 終わっているのに数え続ける → 同上 |

本番の実測（夏期2026・7/6〜8/31 の窓で旧ルールと比較）:
**136行が「夏期に無かったのに数えられていた」/ 59行が「夏期にいたのに落ちていた」。**

このリポジトリには既に期間の概念（`effective_from` / `effective_until`）があり、変更の経路
（`changeRegularPattern`・pattern-matching の担当変更）は旧行を `effective_until` で締めている。
**停止の経路だけが日付を残していなかった**のが根本原因。

- **書く側**: `deleteRegularPattern(id, endDate?)` が `is_active=false` と同時に `effective_until` を入れる。
  既定は今日(JST)。既に `effective_until` が入っている行は上書きしない（変更で締めた履歴を消さない）。
- **読む側**: `runBatchForSchool` の auto_values は `is_active` を見ず、期間の重なりで絞る。
  `patternOverlapsPeriodFilter(start, end)` が条件を組み立て、**期間日付が無い期だけ従来どおり `is_active`**。
  学年別終了日があるので、SQL は一番遅い終了日まで広く取り、**生徒ごとの終了日での絞り込みは JS 側**で行う
  （2月まで続く中3のパターンを、1月で終わる他学年に数えないため）。
- **埋め戻し**: 停止済みで `effective_until` が空だった153行に `updated_at`(JST) の日付を入れた（本番適用済み）。
  空のままだと新ルールで「今も有効」と解釈されて逆に数が増える。厳密な最終通塾日ではない近似。
- 確定済みスナップショットは集計の入力ごと保存しているので、この変更でも動かない
  （夏期2026 は 2026-09-05 に5校とも自動確定済み）。

### Phase 8: 講習期間の区分（2026-09-08）

冬期は生徒によって講習期間が違う。Phase 6 は学年別終了日で表そうとしたが、
**同じ小6でも中学受験する子としない子がいるので、学年では割れない**。
そこで期ごとに「区分」（中学受験・高校受験・大学受験など）を作り、そこに生徒を当てはめる。

DDL: `supabase/migrations/20260908120000_course_prep_tracks.sql`（`course_prep_tracks` /
`course_prep_student_tracks`。RLS は兄弟の `course_prep_*` と同じ `check_school_access()`）。

**当てはめの決まり（優先順）** — 純関数 `resolveStudentTrack`（`src/lib/coursePrepKpis.ts`）:

1. `course_prep_student_tracks` に行があればそれが正典。`track_id` が NULL なら
   「既定を打ち消して共通に戻す」明示指定（**行が無い＝未指定とは意味が違う**）
2. 行が無ければ `default_grades` にその生徒の学年を含む区分（`sort_order` 昇順で最初の1件）
3. どれにも当たらなければ共通の講習期間（`course_prep_periods` の開始日・終了日）

→ 中3は既定の学年で一括、小6の受験生だけ個別に当てはめる、という運用ができる。

| 何を | どこで |
| --- | --- |
| 生徒の期間（開始・終了）を解決 | `resolveTrackWindow`。区分の開始日が空なら共通の開始日 |
| 通常回数（`course_sessions`）を区分の期間で数える | `runBatchForSchool` の auto_values。**開始日も生徒ごとに変わりうる**ので、曜日出現回数のキャッシュキーは `開始日|終了日` |
| 通塾パターンの SQL 取得 | 全区分を含む最も広い窓（最小の開始日〜最大の終了日）で広めに取り、生徒ごとの絞り込みは JS 側（Phase 7 の `inWindow` を開始・終了の両方で判定） |
| 期の終了判定 | `resolvePeriodLastEndDate(period, tracks)` = 共通終了日と全区分の終了日の最大。cron の自動確定・状態バーの `hasPeriodEnded` が使う |
| 区分の定義 | 進捗管理ダッシュボードの「講習期間」欄（教室長以上・確定データ表示中は不可）。API は `upsert_track` / `delete_track` |
| 生徒の当てはめ | 進捗表の生徒名クリックのメニュー。API は `set_student_track`（`'default'` で当てはめ行ごと削除） |
| 表での見え方 | 学年セルの横に短縮名（`trackShortLabel`）。**個別に上書きした子は濃く・既定の学年で入った子は薄く** |

- **スナップショットの payload は `version: 2` に上げた**（`tracks` / `studentTracks` を追加）。
  読む側（`/courses/progress`）は version 1 の payload でも壊れないよう空配列にフォールバックする。
- cron は **SQL 側で終了日に窓をかけない**（Phase 6 と同じ理由。区分の終了日は共通より後になる）。
- 学年別終了日（Phase 6）の実装は撤去した。設定→講習申込の「学年別の講習終了日」セクション、
  `derivePeriodInfo`（申込フォーム）、`realDataAdapter` の可能枠クランプはすべて区分ベースに置き換え。
  `resolveGradeEndDate` / `sanitizeEndByGrade` は「新規利用禁止」の注記を付けて残してある。

## 4. 決めたこと・決めなかったこと

- **版管理はしない。** (school, season, year) に1本。取り直しは上書き。
  「何度も取って比べる」需要が出てから考える。
- **工程表・提案書の中身は保存しない。** 実績の振り返りに要るのは進捗管理表とダッシュボード。
  提案書は削除しない運用（[[講習_提案書FK SET NULL＋偽所持是正]]）で守る。
- **集計結果は焼き付けない。** §2 の原則1のとおり。

## 5. 注意

- 夏期2026 の実績は、9/1 の退塾切り替え以降すでに痩せている。
  [[講習_夏期2026振り返り分析]] の数字（取得率 49.7% / 目標比 92.2%）は**その前に取ったもの**なので、
  Phase 1 適用後に取り直した数字と突き合わせて、戻りきっているか確認すること。
- 通塾パターンの組み替えによるコマ数のずれは Phase 1 では直らない。
  スナップショットを取った時点でしか凍結できないので、**期の終了後は早めに確定させる**（Phase 4 の自動確定が効く）。
