# 特別講座の再設計（通年 ＋ 講習限定）

作成: 2026-08-24 ／ 起点 main `14ad2d56` ／ 正典はこの文書。語彙は §2 で**確定済み**。

## 0. 目指す構造（確定）

```
指導形態（座席表のタブ）: 個別 / 小集団 / プログラミング の3つ
特別講座（学年×科目の開講単位。名前・単価・定員・名簿を持つ）
├── 通年講座: 小集団や国理社オンラインライブ、HAL など。時間割=曜日×コマ。
│              講習期だけ時間を上書きできる（上書きが無ければ通常どおり）
└── 講習講座: 英単語特訓・暗記講座など。その講習期だけ。日付指定
```

- 座席表に載せる／講座は学年×科目
- **指導形態は 個別・小集団・プログラミング の3つ**（確定 2026-08-24）。**HAL は形態ではなく講座**（プログラミング形態の下の通年講座になる想定）
- 名簿は手動入力（確定②）／受講料は請求とつなぐ（確定③）

## 1. 現状（2026-08-24 本番調査）

- 形態: 個別(system)・集団(system)・HAL(`f_zrshafsx`, ユーザー定義)。**HALは patterns=0・entries=0・コマ時間1枠のみ**＝安全に畳める
- クラス枠（`schedule_regular_patterns` formation付き）: 形態ボードの「＋クラス枠」で作る週次枠。**毎週の座席表への自動生成は既に動く機構**。ただし無名（講座名・単価・定員を持てない）。データ0件
- `koushu_special_courses`: 講習期専用の講座マスタ（本番1件=デモの入試対策ゼミ, formation=group）。Web申込ステップ2が参照
- `koushu_enrollments` の集団列: 0件

## 2. 確定した言葉

| 確定語 | 意味 | 実体 |
|---|---|---|
| **指導形態** | 座席表のタブ。**個別／小集団／プログラミング**の3つ | `schedule_formations`。「集団」→ラベル**「小集団」**（キー `group` 不変）。**「プログラミング」を新規シード**。HAL形態は `is_active=false` に畳む |
| **特別講座** | 個別以外の形態で開く開講単位（学年×科目）。名前・単価・定員・名簿 | 新 `special_courses` |
| ├ 通年講座 | 通常期も講習期も開催。時間割=曜日×コマ。講習期は上書き可 | `scope='year_round'`・season/year=NULL |
| └ 講習講座 | その講習期だけ。日付指定 | `scope='koushu'`・season/year必須。現 `koushu_special_courses` を移行 |
| クラス枠 | **廃語**。枠は必ずどれかの講座に属する | `schedule_regular_patterns.special_course_id`（新列） |
| コース | 従来どおり個別指導の学習メニュー（`seasonal_courses`）。特別講座と呼び分ける | 変更なし |

## 3. データ設計

```sql
-- 1) 形態の整理
update schedule_formations set label='小集団' where key='group';
insert into schedule_formations (key,label,lane_type,is_system,is_active,sort_order)
  values ('f_programming','プログラミング','group',false,true,30);  -- 既存の並びの後ろ
update schedule_formations set is_active=false where key='f_zrshafsx';  -- HALは講座へ

-- 2) 特別講座（通年＋講習限定を1テーブル）
create table special_courses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id),
  scope text not null check (scope in ('year_round','koushu')),
  formation text not null references schedule_formations(key),
  name text not null,
  target_grades int[] not null default '{}',
  subject_id uuid null references subjects(id),
  unit_price int null,          -- 決定③ 請求連携用
  capacity int null,
  season text null, year int null,
  session_dates jsonb not null default '[]',   -- 講習講座の開催予定（既存形式踏襲）
  is_active boolean not null default true,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  check (scope <> 'koushu' or (season is not null and year is not null))
);

-- 3) 通年講座の講習期上書き（無ければ通常の時間割のまま開催）
create table special_course_koushu_overrides (
  course_id uuid not null references special_courses(id) on delete cascade,
  season text not null, year int not null,
  session_dates jsonb not null default '[]',
  primary key (course_id, season, year)
);

-- 4) クラス枠→講座リンク（通年講座の時間割・名簿はこれで表現）
alter table schedule_regular_patterns
  add column special_course_id uuid null references special_courses(id) on delete set null;

-- 5) 移行: koushu_special_courses → special_courses(scope='koushu')
--    旧テーブルは残す（読み取り参照をすべて新テーブルへ差し替えたら後日削除）
```

RLS/grantは既存の `koushu_special_courses`（20260805130000）と同じ方針。

## 4. 進め方（フェーズ分割）

**このPR（フェーズ1）:**
1. 上記マイグレーション一式（ファイル作成のみ。本番適用はMCPで別途）
2. `lib/api/specialCourses.ts` 新設（CRUD＋上書きCRUD＋名簿取得=講座に紐づくクラス枠の生徒一覧）
3. 特別講座管理画面（/schedule/special-courses）作り替え: 「通年講座」「講習講座」の2タブ。項目=名前・形態（3つから）・対象学年・科目・単価・定員。講習講座は開催予定表（既存の一括生成UIを流用）。通年講座は時間割（紐づくクラス枠の読み取り一覧）＋講習期の時間上書きの登録
4. 形態ボードの「＋クラス枠」→「講座」を選んでから枠を作る（`special_course_id` を patterns に書く）。その形態の通年講座が0件なら講座作成へ誘導
5. Web申込ローダー（`loadCourses`）・アロケータ・申込管理の参照を `special_courses(scope='koushu')` へ差し替え
6. ヘルプFAQ更新（クラス枠→講座、形態3つ、特別講座の2種）

**後続PR（フェーズ2）:**
- 講習期上書きの週次生成への反映（上書きがある期間はクラス枠の生成を止め、上書き日時で生成）
- 請求連携（講座単価×名簿。請求側の方式は実装時に請求管理と突き合わせ）

## 5. 決定ログ

- 2026-08-24 ①: 語彙確定（§2）。指導形態は個別・小集団・プログラミングの3つ。HALは講座
- 2026-08-24 ②: 名簿は手動入力
- 2026-08-24 ③: 受講料は請求とつなぐ
- 2026-08-24: 座席表に載せる／講座は学年×科目

---

# フェーズ2-A: 講習期上書きの週次生成への反映（仕様）

2026-08-25 着手。ブランチ claude/special-courses-p2。

## 意味論（確定仕様の再掲＋生成規則）

通年講座 × 講習期（`course_prep_periods` の schedule_start_date〜schedule_end_date）について:

| 上書き行 | その講習期のあいだの挙動 |
|---|---|
| 無し | **通常どおり**。定期の枠（曜日×コマ）から今までどおり週次生成する |
| あり（session_dates 非空） | 定期の枠からの生成を**止め**、上書きの日時で生成する |
| あり（session_dates 空配列） | 定期の枠からの生成を止め、**何も生成しない**（その期は開催しない） |

## 実装規則

1. **抑止判定は純関数に1本化**する（`src/lib/schedule/specialCourseOverride.ts`）。
   `generateWeeklySchedule`（生成）と `getExpectedEntryDetailsFromPatterns`（同期チェック）の
   **両方が同じ関数を使う**こと。
   ★ 片方だけに入れると、同期チェックが「不足」と誤検知して画面更新のたびに再生成が走る
   （2026-07-13 の実バグと同型。docs/schedule-system-handoff の同期チェックの意味論を参照）。
   同期チェックの期待キー = 「生成が作るはずのもの」と厳密に一致させる。
2. **上書き分の生成**: 週に重なる上書き session（date/start_time/end_time）ごとに、
   - コマ解決: `schedule_time_slots`（その講座の formation・is_active）から **start_time の完全一致**で引く。
     一致が無ければその session は生成しない（console.warn。UI 側の警告が主対策）。
   - 名簿 = その講座に紐づく有効な枠（`schedule_regular_patterns.special_course_id`、
     effective_from/until がその日を覆うもの）の生徒（重複排除）。
   - 生徒ごとに entries を作成: `kind='koushu'`・formation=講座の形態・teacher_id=その生徒の枠の講師
     （複数枠なら作成日時の古い枠を採用＝決定的に）・subject_ids=枠のもの・status='scheduled'。
   - 冪等: 既存の生成スキップ規則と同じ「同一 (date, slot, student) に行があれば作らない」。
3. **上書き登録UIの検証**（YearRoundCourseDetailModal）: 保存時、各 session の start_time が
   その形態のコマ時間に存在しなければ行単位で警告を出す（保存は許す。コマ時間を後から
   足す運用があり得るため）。あわせて「登録済みの週に既に生成されたコマは自動では消えません。
   座席表で削除してください」の注意書きを出す。
4. **消し込みはしない**: 生成は挿入のみ（既存方針）。上書きを後から変えた場合の余った行は
   手動で消す（日程変更未反映アラートと同じ思想。自動削除は手動調整を巻き戻す罠）。
5. テスト: 抑止判定・コマ解決・名簿解決の純関数と、
   「生成と同期チェックの期待が一致する」ことを固定するシナリオテストを必ず置く。

# フェーズ2-B: 請求連携（調査中）

講座 `unit_price` × 名簿を請求へ。請求側の構造調査（billing のデータモデル・増コマ同期の方式）
の結果を受けて仕様を書く。

---

# フェーズ2-B: 特別講座の請求連携（仕様）

2026-08-25 着手。請求側の構造調査（billing_items=教室×期間ごとの動的列 / student_billings=生徒×項目のセル /
既存の増コマ同期 `syncCourseExtraToBilling` の名前ベース検出方式）を踏まえた設計。**DBマイグレーション無し**。

## 方式（既存の増コマ同期の完全踏襲）

- **列の検出**: `value_type='number'`・`linked_form_type` 無し・**名前に「特別講座」を含む** billing_item に
  「特別講座から同期」ボタンを出す（`isCourseExtraItem` と同じ名前ベース検出。判定関数 `isSpecialCourseItem` を
  BillingTable に追加。増コマ列の検出条件と重複しないこと＝「講習」を含み「特別講座」も含む名前は特別講座側を優先）。
- **セルに入れる値**: **金額（円）**。講座ごとに単価が違うため回数ではなく金額を合算する。
- **計上済み保護**: `computeCourseExtraSplit` と同じ split（既存 quantity は保持し、新合計との差分を
  value_number=未計上へ。0円の生徒は行を作らない）。quantity/value_number の意味は既存規約どおり。

## 同期ダイアログ

ボタン押下 → ダイアログで**対象を選ぶ**:

1. **通年講座（月次）**: 対象月を選択（既定=請求期間名 "YYYY年M月" のパース結果。パース不可なら start_date の月）。
   月謝先取りの商習慣（5週目ロジックが請求月+1ヶ月を見る）があるため、対象月は固定せず選ばせる。
2. **講習講座（期に1回）**: 季節・年を選択（増コマ同期のダイアログと同じUI）。

## 金額計算（純関数 `src/lib/billing/specialCourseBilling.ts`・テスト必須）

### 通年講座

生徒ごとに `Σ(講座ごと: unit_price × その月の受講回数)`。

受講回数は**フェーズ2-Aの planWeeklyEntries をそのまま使って数える**:
対象月に重なる各週について planWeeklyEntries を呼び、`specialCourseId != null`（=講座由来。定期・上書き両方）かつ
日付が対象月内の計画コマを生徒×講座で数える。
★ 自前で「曜日出現数 × 単価」を数え直さないこと。講習期上書き（定期停止・休講・振替日程）を
  二重実装すると座席表と請求で回数がズレる。生成と同じ関数を通せば定義上一致する。
※ planWeeklyEntries の regular 側 PlannedEntry に specialCourseId が乗っていない場合は
  乗せる改修をしてよい（source='regular' でも pattern.special_course_id を透過させる）。

### 講習講座

対象 (school, season, year) の scope='koushu' 講座について、
`koushu_enrollments`（course_id=講座）の生徒ごとに `unit_price × koma_count` を合算。

### 共通

- `unit_price` が NULL の講座は**計上せず**、同期結果ダイアログ/トーストに講座名を出して知らせる
  （黙って0円にしない）。
- 対象講座が0件・対象生徒0件は「0件でした」を明示。

## 触るファイル

- `src/lib/billing/specialCourseBilling.ts`（新規・純関数: 月内回数集計・金額合算・split）
- `src/lib/api/billing.ts`: `syncSpecialCourseToBilling(billingItemId, schoolIds, target)` を
  `syncCourseExtraToBilling`（1421-1501行）を雛形に新設
- `src/components/billing/BillingTable.tsx`: `isSpecialCourseItem` 判定＋同期ボタン＋対象選択ダイアログ
  （courseExtraSync の流儀）
- `src/app/help/page.tsx`: 請求のFAQに「特別講座の同期」を追記

## やらないこと

- billing_items への専用 source_type / 講座IDリンク列の追加（名前ベース検出で足りる。増コマ列と同じ
  「項目名を変えると計上済みが表示から外れる」既知の罠は引き継ぐ＝ヘルプに明記）
- 自動計上（cron 等）。同期は室長のボタン操作のみ

---

# フェーズ3: 講座の定例枠を画面から使う（曜日・コマ）

2026-08-25。列 `special_courses.day_of_week` / `time_slot_id` は追加・本番適用済み（PR #73）。
実データ（永山校の国理社オンラインライブ9講座）も投入済み。**画面がまだこの列を使っていない**ので繋ぐ。

## 解く問題

1. 講座フォームに曜日・コマの欄が無い。投入済みのデータを画面から見ることも直すこともできない。
2. 形態ボードの「＋講座の枠」が、クリックしたセル（曜日×コマ）に関係なく全講座を出す。
   中1理A（月19:10）を火曜のセルに置けてしまい、講座の定例枠と枠の実際がずれる。

## 実装

### 1. 講座フォーム（SpecialCourseFormModal）
- **通年講座のときだけ** 曜日（日〜土）とコマのセレクトを出す。コマはその講座の形態の
  `schedule_time_slots`（is_active）を「#n 開始-終了」で並べる。
- 講習講座のときは出さない（日付指定の session_dates が担当）。切り替えたら値をクリアする。
- 任意入力にする（未設定の講座も作れる）。ただし未設定だと枠作成の候補に出ないので、
  フォームに「未設定だと座席表の枠から選べません」の注記を出す。

### 2. 講座一覧（special-courses ページの通年タブ）
- 行に「月 19:10-20:10」を出す。未設定は「未設定」をグレーで。

### 3. 形態ボードの枠モーダル（FormationKomaFormModal）
- 親（schedule/page.tsx）が渡す `courses` を、**クリックしたセルの曜日とコマに一致する講座だけ**に絞る。
  - 曜日はセルの日付から求める（`new Date(date+'T12:00:00').getDay()`）。
  - 一致0件のときは「このコマに開催する講座がありません」＋特別講座管理へのリンク（既存の
    0件時の導線を流用）。曜日・コマ未設定の講座は候補に出さない（上の注記と対）。
  - 'add'（既存クラスへの生徒追加）は従来どおり枠から講座を引き継ぐので絞り込み不要。
- 候補が1件なら既定選択（既存挙動を維持）。

### 4. API / 型
- `SpecialCourse` 型と CRUD に `day_of_week` / `time_slot_id` を通す。
- 絞り込みは純関数 `filterCoursesForCell(courses, dayOfWeek, timeSlotId)` に切り出してテスト
  （未設定を除外する・曜日とコマの両方一致・順序安定）。

## やらないこと
- 枠作成時に曜日・コマを講座から自動で埋める（セルから既に決まっているので不要）
- 既存の枠（special_course_id 付き）と講座の定例枠の整合チェック（今は枠0件。必要になったら別途）
