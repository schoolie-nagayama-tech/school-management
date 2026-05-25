-- schedule_entries に「種別 (kind)」「形態 (formation)」を追加
-- 背景：
--  - 種別: 通常授業 (regular) と講習 (koushu) を区別したい
--    講習は通常通塾日程と独立に座席表へ乗り、マッチング機能の対象になる
--  - 形態: 個別指導 (individual) と集団指導 (group) を区別したい
--    1講師あたり生徒数や座席容量、コマ時間マスタが個別/集団で異なる

-- 1. schedule_entries に kind カラム追加
ALTER TABLE "public"."schedule_entries"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'regular';

ALTER TABLE "public"."schedule_entries"
  DROP CONSTRAINT IF EXISTS "schedule_entries_kind_check";
ALTER TABLE "public"."schedule_entries"
  ADD CONSTRAINT "schedule_entries_kind_check"
  CHECK ("kind" IN ('regular', 'koushu'));

COMMENT ON COLUMN "public"."schedule_entries"."kind"
  IS '授業種別。regular=通常授業（通塾日程から自動生成）、koushu=講習（季節講座、通塾日程と独立）。';

-- 2. schedule_entries に formation カラム追加
ALTER TABLE "public"."schedule_entries"
  ADD COLUMN IF NOT EXISTS "formation" TEXT NOT NULL DEFAULT 'individual';

ALTER TABLE "public"."schedule_entries"
  DROP CONSTRAINT IF EXISTS "schedule_entries_formation_check";
ALTER TABLE "public"."schedule_entries"
  ADD CONSTRAINT "schedule_entries_formation_check"
  CHECK ("formation" IN ('individual', 'group'));

COMMENT ON COLUMN "public"."schedule_entries"."formation"
  IS '授業形態。individual=個別指導（1講師あたり数名、座席ブース）、group=集団指導（1講師あたり多人数、教室まるごと）。';

-- 3. 検索性能向上のためインデックス追加
--    座席表表示・マッチング・集計で「学校×日付×種別」「学校×日付×形態」での絞り込みが頻発する
CREATE INDEX IF NOT EXISTS "idx_schedule_entries_kind"
  ON "public"."schedule_entries" ("school_id", "entry_date", "kind");

CREATE INDEX IF NOT EXISTS "idx_schedule_entries_formation"
  ON "public"."schedule_entries" ("school_id", "entry_date", "formation");
