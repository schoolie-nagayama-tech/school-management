-- =====================================================
-- プログラミング受講フラグ
-- =====================================================
ALTER TABLE "public"."students"
  ADD COLUMN IF NOT EXISTS "is_programming" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_students_is_programming
  ON "public"."students"("is_programming")
  WHERE "is_programming" = true;
