-- 授業生徒数設定（学校ごとの容量上限）
-- 背景：
--  - 個別: 1講師あたり生徒数（デフォルト2）、教室全体の同時席数（デフォルト12）
--  - 集団: 1コマあたり生徒数（デフォルト8）、同時開催コマ数（デフォルト1）
--  - 学校ごとに変えられるようにする（運営方針が校舎で違うため）

CREATE TABLE IF NOT EXISTS "public"."school_class_capacity" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id" UUID NOT NULL UNIQUE REFERENCES "public"."schools"("id") ON DELETE CASCADE,

  -- 個別指導の上限
  "max_students_per_teacher_individual" INTEGER NOT NULL DEFAULT 2
    CHECK ("max_students_per_teacher_individual" >= 1 AND "max_students_per_teacher_individual" <= 10),
  "total_individual_seats" INTEGER NOT NULL DEFAULT 12
    CHECK ("total_individual_seats" >= 1 AND "total_individual_seats" <= 100),

  -- 集団指導の上限
  "max_students_per_group" INTEGER NOT NULL DEFAULT 8
    CHECK ("max_students_per_group" >= 1 AND "max_students_per_group" <= 100),
  "max_concurrent_groups" INTEGER NOT NULL DEFAULT 1
    CHECK ("max_concurrent_groups" >= 1 AND "max_concurrent_groups" <= 20),

  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "public"."school_class_capacity"
  IS '学校ごとの授業生徒数上限設定。スケジュール作成・マッチング時のバリデーションに使用。';
COMMENT ON COLUMN "public"."school_class_capacity"."max_students_per_teacher_individual"
  IS '個別指導：1講師あたりの生徒上限（デフォルト2 = 1対2まで）。';
COMMENT ON COLUMN "public"."school_class_capacity"."total_individual_seats"
  IS '個別指導：教室全体の同時席数（デフォルト12）。';
COMMENT ON COLUMN "public"."school_class_capacity"."max_students_per_group"
  IS '集団指導：1コマあたりの生徒上限（デフォルト8）。';
COMMENT ON COLUMN "public"."school_class_capacity"."max_concurrent_groups"
  IS '集団指導：同時に開催できる集団コマ数（デフォルト1 = 1室のみ）。';

DROP TRIGGER IF EXISTS update_school_class_capacity_updated_at ON "public"."school_class_capacity";
CREATE TRIGGER update_school_class_capacity_updated_at
  BEFORE UPDATE ON "public"."school_class_capacity"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "public"."school_class_capacity" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "school_class_capacity_allow_all_auth" ON "public"."school_class_capacity";
CREATE POLICY "school_class_capacity_allow_all_auth" ON "public"."school_class_capacity"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 既存スクールにデフォルト行をシード
INSERT INTO "public"."school_class_capacity" ("school_id")
SELECT "id" FROM "public"."schools"
ON CONFLICT ("school_id") DO NOTHING;
