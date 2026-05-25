-- 生徒の講師希望と、講師の性別カラムを追加
-- 背景（マッチング用）：
--  - 「Aさんは女性講師のみ」「Bさんは山田講師固定」「Cさんは鈴木講師NG」を表現したい
--  - マッチング時のフィルタとして使う（現状は手動配置のみだが、将来の自動マッチング機能の入力データ）

-- 1. user_profiles に性別 (gender) を追加
ALTER TABLE "public"."user_profiles"
  ADD COLUMN IF NOT EXISTS "gender" TEXT;

ALTER TABLE "public"."user_profiles"
  DROP CONSTRAINT IF EXISTS "user_profiles_gender_check";
ALTER TABLE "public"."user_profiles"
  ADD CONSTRAINT "user_profiles_gender_check"
  CHECK ("gender" IS NULL OR "gender" IN ('male', 'female', 'other'));

COMMENT ON COLUMN "public"."user_profiles"."gender"
  IS '性別。NULL=未設定、male=男性、female=女性、other=その他。生徒の「女性講師希望」マッチングで使用。';

-- 2. students に講師希望カラム3種を追加
ALTER TABLE "public"."students"
  ADD COLUMN IF NOT EXISTS "preferred_teacher_gender" TEXT,
  ADD COLUMN IF NOT EXISTS "fixed_teacher_ids" UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "excluded_teacher_ids" UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE "public"."students"
  DROP CONSTRAINT IF EXISTS "students_preferred_teacher_gender_check";
ALTER TABLE "public"."students"
  ADD CONSTRAINT "students_preferred_teacher_gender_check"
  CHECK ("preferred_teacher_gender" IS NULL OR "preferred_teacher_gender" IN ('male', 'female'));

COMMENT ON COLUMN "public"."students"."preferred_teacher_gender"
  IS '希望講師性別。NULL=指定なし、male=男性のみ、female=女性のみ。';
COMMENT ON COLUMN "public"."students"."fixed_teacher_ids"
  IS '担当固定講師ID配列。マッチングではこの中の講師を優先（または強制）。';
COMMENT ON COLUMN "public"."students"."excluded_teacher_ids"
  IS '指名NG講師ID配列。マッチングでこの講師は割り当てない。';
