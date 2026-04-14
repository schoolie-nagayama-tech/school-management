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
CREATE INDEX IF NOT EXISTS idx_teacher_badges_category ON "public"."teacher_badges"("category");
CREATE INDEX IF NOT EXISTS idx_teacher_badges_active ON "public"."teacher_badges"("is_active", "sort_order");

-- updated_at トリガー
DROP TRIGGER IF EXISTS update_teacher_badges_updated_at ON "public"."teacher_badges";
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
CREATE INDEX IF NOT EXISTS idx_teacher_badge_assignments_teacher ON "public"."teacher_badge_assignments"("teacher_id");
CREATE INDEX IF NOT EXISTS idx_teacher_badge_assignments_badge ON "public"."teacher_badge_assignments"("badge_id");

-- =====================================================
-- RLS
-- =====================================================

ALTER TABLE "public"."teacher_badges" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teacher_badges_select" ON "public"."teacher_badges";
CREATE POLICY "teacher_badges_select"
  ON "public"."teacher_badges" FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "teacher_badges_insert" ON "public"."teacher_badges";
CREATE POLICY "teacher_badges_insert"
  ON "public"."teacher_badges" FOR INSERT TO authenticated
  WITH CHECK ("public"."check_user_role"(ARRAY['admin','owner','manager']));

DROP POLICY IF EXISTS "teacher_badges_update" ON "public"."teacher_badges";
CREATE POLICY "teacher_badges_update"
  ON "public"."teacher_badges" FOR UPDATE TO authenticated
  USING ("public"."check_user_role"(ARRAY['admin','owner','manager']));

DROP POLICY IF EXISTS "teacher_badges_delete" ON "public"."teacher_badges";
CREATE POLICY "teacher_badges_delete"
  ON "public"."teacher_badges" FOR DELETE TO authenticated
  USING ("public"."check_user_role"(ARRAY['admin','owner','manager']));

ALTER TABLE "public"."teacher_badge_assignments" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "teacher_badge_assignments_select" ON "public"."teacher_badge_assignments";
CREATE POLICY "teacher_badge_assignments_select"
  ON "public"."teacher_badge_assignments" FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "teacher_badge_assignments_insert" ON "public"."teacher_badge_assignments";
CREATE POLICY "teacher_badge_assignments_insert"
  ON "public"."teacher_badge_assignments" FOR INSERT TO authenticated
  WITH CHECK ("public"."check_user_role"(ARRAY['admin','owner','manager']));

DROP POLICY IF EXISTS "teacher_badge_assignments_update" ON "public"."teacher_badge_assignments";
CREATE POLICY "teacher_badge_assignments_update"
  ON "public"."teacher_badge_assignments" FOR UPDATE TO authenticated
  USING ("public"."check_user_role"(ARRAY['admin','owner','manager']));

DROP POLICY IF EXISTS "teacher_badge_assignments_delete" ON "public"."teacher_badge_assignments";
CREATE POLICY "teacher_badge_assignments_delete"
  ON "public"."teacher_badge_assignments" FOR DELETE TO authenticated
  USING ("public"."check_user_role"(ARRAY['admin','owner','manager']));

-- =====================================================
-- デフォルトバッジテンプレート（初期データ）
-- =====================================================

-- 重複防止: 既存名と一致しないものだけINSERT
INSERT INTO "public"."teacher_badges" ("name", "category", "rank", "icon", "description", "sort_order")
SELECT v.name, v.category, v.rank, v.icon, v.description, v.sort_order
FROM (VALUES
  -- 研修カテゴリ
  ('初期研修完了',       'training', 'bronze',   'book',        '入社時の初期研修をすべて完了',                     10),
  ('安全管理研修',       'training', 'bronze',   'shield',      '安全管理・緊急時対応研修を修了',                   20),
  ('コンプライアンス研修', 'training', 'silver',  'certificate', 'コンプライアンス・個人情報保護研修を修了',         30),
  ('指導力向上研修',     'training', 'gold',     'target',      '指導スキル向上のための応用研修を修了',             40),
  ('リーダー研修',       'training', 'platinum', 'crown',       '教室リーダー・後輩指導のための上級研修を修了',     50),
  -- スキルカテゴリ（ランク外 = ただ「それができる」ことを表すフラットなバッジ）
  ('英語指導可',         'skill', 'neutral',  'book',       '英語の指導が可能',                                  110),
  ('数学指導可',         'skill', 'neutral',  'book',       '数学の指導が可能',                                  111),
  ('国語指導可',         'skill', 'neutral',  'book',       '国語の指導が可能',                                  112),
  ('理科指導可',         'skill', 'neutral',  'book',       '理科の指導が可能',                                  113),
  ('社会指導可',         'skill', 'neutral',  'book',       '社会の指導が可能',                                  114),
  ('マルチ科目指導',     'skill', 'silver',   'puzzle',     '3科目以上の指導が可能',                            120),
  ('指導科目マスター',   'skill', 'gold',     'graduation', '5科目以上の指導が可能',                            130),
  ('全科目対応',         'skill', 'platinum', 'gem',        '全主要科目の指導が可能',                            140),
  -- 実績カテゴリ
  ('レギュラーメンバー', 'achievement', 'bronze',   'flag',    '週3コマ以上の出勤が可能',                         210),
  ('主力メンバー',       'achievement', 'silver',   'star',    '週5コマ以上の出勤が可能',                         220),
  ('勤続半年',           'achievement', 'bronze',   'medal',   '勤続期間が6ヶ月を達成',                           230),
  ('勤続1年',            'achievement', 'silver',   'award',   '勤続期間が1年を達成',                             240),
  ('勤続3年',            'achievement', 'gold',     'trophy',  '勤続期間が3年を達成',                             250),
  ('勤続5年',            'achievement', 'platinum', 'crown',   '勤続期間が5年を達成 — ベテラン講師の証',          260),
  ('皆勤賞',             'achievement', 'gold',     'lightning','月間の予定コマをすべて出勤（欠勤・遅刻なし）',    270)
) AS v(name, category, rank, icon, description, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM "public"."teacher_badges" b WHERE b.name = v.name
);
