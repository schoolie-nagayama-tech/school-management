-- 通塾日程に「形態 (formation)」を追加
-- 背景：
--  - schedule_entries に formation を追加した（個別/集団）。
--  - 通塾日程からの自動生成で formation を引き継げるようにするため、パターン側にもカラムを持たせる。
--  - 1人の生徒が「個別の月曜枠」「集団の水曜枠」のように複数パターンを持てる（formationは行ごとに違う）。

ALTER TABLE "public"."schedule_regular_patterns"
  ADD COLUMN IF NOT EXISTS "formation" TEXT NOT NULL DEFAULT 'individual';

ALTER TABLE "public"."schedule_regular_patterns"
  DROP CONSTRAINT IF EXISTS "schedule_regular_patterns_formation_check";
ALTER TABLE "public"."schedule_regular_patterns"
  ADD CONSTRAINT "schedule_regular_patterns_formation_check"
  CHECK ("formation" IN ('individual', 'group'));

COMMENT ON COLUMN "public"."schedule_regular_patterns"."formation"
  IS '授業形態。individual=個別、group=集団。スケジュール自動生成時に schedule_entries.formation へ引き継がれる。';

-- インデックス（形態別の集計・絞り込み用）
CREATE INDEX IF NOT EXISTS "idx_schedule_regular_patterns_formation"
  ON "public"."schedule_regular_patterns" ("school_id", "formation")
  WHERE "is_active" = true;
