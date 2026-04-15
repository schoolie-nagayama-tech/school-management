-- =====================================================
-- 研修マスタ（管理者が登録 → 講師登録時にドロップダウン選択）
-- =====================================================

CREATE TABLE IF NOT EXISTS "public"."training_masters" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL UNIQUE,
  "period_label" TEXT,                   -- 例: "2026年春期"
  "description" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by" UUID REFERENCES "public"."user_profiles"("id"),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_masters_active_sort
  ON "public"."training_masters"("is_active", "sort_order");

-- =====================================================
-- teacher_trainings に training_master_id を追加（任意リンク）
-- =====================================================

ALTER TABLE "public"."teacher_trainings"
  ADD COLUMN IF NOT EXISTS "training_master_id" UUID
  REFERENCES "public"."training_masters"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_teacher_trainings_master
  ON "public"."teacher_trainings"("training_master_id");

-- =====================================================
-- RLS
-- =====================================================

ALTER TABLE "public"."training_masters" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "training_masters_select" ON "public"."training_masters";
CREATE POLICY "training_masters_select"
  ON "public"."training_masters" FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "training_masters_insert" ON "public"."training_masters";
CREATE POLICY "training_masters_insert"
  ON "public"."training_masters" FOR INSERT TO authenticated
  WITH CHECK ("public"."check_user_role"(ARRAY['admin','owner','manager']));

DROP POLICY IF EXISTS "training_masters_update" ON "public"."training_masters";
CREATE POLICY "training_masters_update"
  ON "public"."training_masters" FOR UPDATE TO authenticated
  USING ("public"."check_user_role"(ARRAY['admin','owner','manager']));

DROP POLICY IF EXISTS "training_masters_delete" ON "public"."training_masters";
CREATE POLICY "training_masters_delete"
  ON "public"."training_masters" FOR DELETE TO authenticated
  USING ("public"."check_user_role"(ARRAY['admin','owner','manager']));
