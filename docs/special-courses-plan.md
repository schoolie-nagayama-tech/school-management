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
