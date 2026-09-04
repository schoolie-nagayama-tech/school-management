# 講習進捗管理表 スナップショット計画

作成: 2026-09-04 / 状態: Phase 1〜5 実装済み・DBマイグレーション未適用・実機未検証

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
- 生徒名クリックの生徒詳細モーダルは、スナップショット表示中は開かない（凍結物と現在の生徒情報が混ざるため）。

### Phase 4: 自動確定

日次 cron で「`schedule_end_date` を過ぎていて、まだスナップショットが無い期」を1回だけ保存する（`capture_reason='auto'`）。
Phase 1 で退塾者が消えなくなっているので、退塾 cron との実行順に依存しない。

### Phase 5: 仕上げ

- `help/page.tsx` の `FAQ_DATA` を更新（[[進め方_機能変更時にヘルプ更新]]）。
- 夏期2026 を遡って確定保存する（Phase 1 適用後、退塾者が戻ってから）。

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
