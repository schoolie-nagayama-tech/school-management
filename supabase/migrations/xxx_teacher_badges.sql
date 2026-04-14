-- =====================================================
-- 講師バッジ / トロフィーシステム
-- =====================================================

-- バッジテンプレート（マスタ）
CREATE TABLE IF NOT EXISTS "public"."teacher_badges" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'training',   -- 'training' | 'skill' | 'achievement'
  "rank" TEXT NOT NULL DEFAULT 'bronze',          -- 'bronze' | 'silver' | 'gold' | 'platinum'
  "icon" TEXT NOT NULL DEFAULT 'star',            -- アイコン識別子
  "description" TEXT,
  "sort_order" INT NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID REFERENCES "public"."user_profiles"("id"),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_teacher_badges_category ON "public"."teacher_badges"("category");
CREATE INDEX idx_teacher_badges_active ON "public"."teacher_badges"("is_active", "sort_order");

-- updated_at トリガー
CREATE TRIGGER update_teacher_badges_updated_at
  BEFORE UPDATE ON "public"."teacher_badges"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();

-- 講師へのバッジ付与
CREATE TABLE IF NOT EXISTS "public"."teacher_badge_assignments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "teacher_id" UUID NOT NULL REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE,
  "badge_id" UUID NOT NULL REFERENCES "public"."teacher_badges"("id") ON DELETE CASCADE,
  "completed_at" DATE,
  "note" TEXT,
  "assigned_by" UUID REFERENCES "public"."user_profiles"("id"),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE("teacher_id", "badge_id")
);

-- インデックス
CREATE INDEX idx_teacher_badge_assignments_teacher ON "public"."teacher_badge_assignments"("teacher_id");
CREATE INDEX idx_teacher_badge_assignments_badge ON "public"."teacher_badge_assignments"("badge_id");

-- =====================================================
-- RLS
-- =====================================================

ALTER TABLE "public"."teacher_badges" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teacher_badges_select"
  ON "public"."teacher_badges" FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "teacher_badges_insert"
  ON "public"."teacher_badges" FOR INSERT TO authenticated
  WITH CHECK ("public"."check_user_role"(ARRAY['admin','owner','manager']));

CREATE POLICY "teacher_badges_update"
  ON "public"."teacher_badges" FOR UPDATE TO authenticated
  USING ("public"."check_user_role"(ARRAY['admin','owner','manager']));

CREATE POLICY "teacher_badges_delete"
  ON "public"."teacher_badges" FOR DELETE TO authenticated
  USING ("public"."check_user_role"(ARRAY['admin','owner','manager']));

ALTER TABLE "public"."teacher_badge_assignments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teacher_badge_assignments_select"
  ON "public"."teacher_badge_assignments" FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "teacher_badge_assignments_insert"
  ON "public"."teacher_badge_assignments" FOR INSERT TO authenticated
  WITH CHECK ("public"."check_user_role"(ARRAY['admin','owner','manager']));

CREATE POLICY "teacher_badge_assignments_update"
  ON "public"."teacher_badge_assignments" FOR UPDATE TO authenticated
  USING ("public"."check_user_role"(ARRAY['admin','owner','manager']));

CREATE POLICY "teacher_badge_assignments_delete"
  ON "public"."teacher_badge_assignments" FOR DELETE TO authenticated
  USING ("public"."check_user_role"(ARRAY['admin','owner','manager']));
