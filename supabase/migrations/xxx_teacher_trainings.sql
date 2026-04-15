-- =====================================================
-- 講師の研修参加履歴（バッジとは別の期別講習参加ログ）
-- =====================================================

CREATE TABLE IF NOT EXISTS "public"."teacher_trainings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "teacher_id" UUID NOT NULL REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,                 -- 例: "春期講習", "夏期オリエンテーション"
  "period_label" TEXT,                   -- 例: "2026年春期"
  "attended_on" DATE,                    -- 参加日（任意）
  "note" TEXT,
  "created_by" UUID REFERENCES "public"."user_profiles"("id"),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_trainings_teacher ON "public"."teacher_trainings"("teacher_id");
CREATE INDEX IF NOT EXISTS idx_teacher_trainings_attended_on ON "public"."teacher_trainings"("attended_on" DESC);

-- =====================================================
-- RLS
-- =====================================================

ALTER TABLE "public"."teacher_trainings" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teacher_trainings_select" ON "public"."teacher_trainings";
CREATE POLICY "teacher_trainings_select"
  ON "public"."teacher_trainings" FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "teacher_trainings_insert" ON "public"."teacher_trainings";
CREATE POLICY "teacher_trainings_insert"
  ON "public"."teacher_trainings" FOR INSERT TO authenticated
  WITH CHECK ("public"."check_user_role"(ARRAY['admin','owner','manager']));

DROP POLICY IF EXISTS "teacher_trainings_update" ON "public"."teacher_trainings";
CREATE POLICY "teacher_trainings_update"
  ON "public"."teacher_trainings" FOR UPDATE TO authenticated
  USING ("public"."check_user_role"(ARRAY['admin','owner','manager']));

DROP POLICY IF EXISTS "teacher_trainings_delete" ON "public"."teacher_trainings";
CREATE POLICY "teacher_trainings_delete"
  ON "public"."teacher_trainings" FOR DELETE TO authenticated
  USING ("public"."check_user_role"(ARRAY['admin','owner','manager']));
