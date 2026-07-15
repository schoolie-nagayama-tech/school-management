-- 日次の講師ブース番号割当
-- 背景：
--  - 個別ブースを物理的に番号で管理（例：ブース1〜12）。
--  - 講師の出勤位置は日によって変わるため、(school_id, date, teacher_id) → booth_no で記録する。
--  - 印刷時に座席表として配布する際、講師名の隣にブース番号が表示される。
--  - 日次設定なので、座席表のメインデータ（schedule_entries）には載せず別テーブルにする。

CREATE TABLE IF NOT EXISTS "public"."schedule_daily_booth_assignments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id" UUID NOT NULL REFERENCES "public"."schools"("id") ON DELETE CASCADE,
  "assignment_date" DATE NOT NULL,
  "teacher_id" UUID NOT NULL REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE,
  -- ブース番号。1以上、教室全体席数以下を想定（バリデーションはアプリ側で実施。DBは緩めの上限）
  "booth_no" INTEGER NOT NULL CHECK ("booth_no" >= 1 AND "booth_no" <= 100),
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),

  -- 同日同講師は1番号のみ
  UNIQUE ("school_id", "assignment_date", "teacher_id"),
  -- 同日同番号は1講師のみ（ブース番号の二重割当を防ぐ）
  UNIQUE ("school_id", "assignment_date", "booth_no")
);

COMMENT ON TABLE "public"."schedule_daily_booth_assignments"
  IS '日次の講師ブース番号割当。座席表印刷時に講師名の隣に表示される番号を管理。';
COMMENT ON COLUMN "public"."schedule_daily_booth_assignments"."booth_no"
  IS 'ブース番号（1始まり）。同日内で同じ番号は1講師しか取れない。';

CREATE INDEX IF NOT EXISTS "idx_schedule_daily_booth_assignments_date"
  ON "public"."schedule_daily_booth_assignments" ("school_id", "assignment_date");

DROP TRIGGER IF EXISTS update_schedule_daily_booth_assignments_updated_at
  ON "public"."schedule_daily_booth_assignments";
CREATE TRIGGER update_schedule_daily_booth_assignments_updated_at
  BEFORE UPDATE ON "public"."schedule_daily_booth_assignments"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "public"."schedule_daily_booth_assignments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schedule_daily_booth_assignments_allow_all_auth"
  ON "public"."schedule_daily_booth_assignments";
CREATE POLICY "schedule_daily_booth_assignments_allow_all_auth"
  ON "public"."schedule_daily_booth_assignments"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
