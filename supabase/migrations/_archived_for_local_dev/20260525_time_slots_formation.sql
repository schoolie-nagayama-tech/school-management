-- コマ時間マスタを個別/集団で別建てに
-- 背景：
--  - 個別19:30-21:00、集団20:20-21:20 のように、形態によってコマ時間自体が違う。
--  - UNIQUE(school_id, slot_number) のままだと「個別1限」と「集団1限」が衝突するので、
--    UNIQUE に formation を含めて、形態ごとに slot_number を独立させる。

-- 1. formation カラム追加
ALTER TABLE "public"."schedule_time_slots"
  ADD COLUMN IF NOT EXISTS "formation" TEXT NOT NULL DEFAULT 'individual';

ALTER TABLE "public"."schedule_time_slots"
  DROP CONSTRAINT IF EXISTS "schedule_time_slots_formation_check";
ALTER TABLE "public"."schedule_time_slots"
  ADD CONSTRAINT "schedule_time_slots_formation_check"
  CHECK ("formation" IN ('individual', 'group'));

COMMENT ON COLUMN "public"."schedule_time_slots"."formation"
  IS 'コマ時間の対象形態。individual=個別用の時間枠、group=集団用の時間枠。';

-- 2. UNIQUE 制約を (school_id, formation, slot_number) に張り替え
--    既存の UNIQUE(school_id, slot_number) は維持できないので、置き換える
ALTER TABLE "public"."schedule_time_slots"
  DROP CONSTRAINT IF EXISTS "schedule_time_slots_school_id_slot_number_key";

-- 既存データに対しては formation='individual' で UNIQUE が成り立つ前提（既存は全て個別）
ALTER TABLE "public"."schedule_time_slots"
  DROP CONSTRAINT IF EXISTS "schedule_time_slots_school_formation_slot_unique";
ALTER TABLE "public"."schedule_time_slots"
  ADD CONSTRAINT "schedule_time_slots_school_formation_slot_unique"
  UNIQUE ("school_id", "formation", "slot_number");

-- 3. インデックス（形態別の取得を高速化）
CREATE INDEX IF NOT EXISTS "idx_schedule_time_slots_formation"
  ON "public"."schedule_time_slots" ("school_id", "formation", "is_active", "display_order");
