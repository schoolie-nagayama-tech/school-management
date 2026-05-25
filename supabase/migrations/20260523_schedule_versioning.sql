-- 通塾日程の時系列バージョン管理＋退塾日対応
-- 背景：
--  - 「来月から週2→週3」「3月末で退塾」など、未来時点からの変更を予約したい
--  - 過去月の5週目請求コマ数は、その月時点で有効な通塾日程で計算したい
--  - 退塾日以降は通塾日程・座席表生成・5週目計算から自動的に除外したい

-- 1. schedule_regular_patterns に有効期間カラムを追加
ALTER TABLE "public"."schedule_regular_patterns"
  ADD COLUMN IF NOT EXISTS "effective_from" DATE NOT NULL DEFAULT '2020-01-01',
  ADD COLUMN IF NOT EXISTS "effective_until" DATE;

COMMENT ON COLUMN "public"."schedule_regular_patterns"."effective_from"
  IS '通塾日程の適用開始日。この日以降のスケジュール生成・5週目計算で参照される。';
COMMENT ON COLUMN "public"."schedule_regular_patterns"."effective_until"
  IS '通塾日程の適用終了日（含む）。NULL の場合は無期限。退塾や曜日変更時に旧パターンへセットする。';

-- effective_from は default で値が入るので NOT NULL 制約はそのまま維持
-- effective_until が effective_from より前にならないようチェック
ALTER TABLE "public"."schedule_regular_patterns"
  DROP CONSTRAINT IF EXISTS "schedule_regular_patterns_effective_range_check";
ALTER TABLE "public"."schedule_regular_patterns"
  ADD CONSTRAINT "schedule_regular_patterns_effective_range_check"
  CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from");

-- 日付範囲検索を高速化するインデックス
CREATE INDEX IF NOT EXISTS "idx_schedule_regular_patterns_effective"
  ON "public"."schedule_regular_patterns" ("school_id", "effective_from", "effective_until")
  WHERE "is_active" = true;

-- 2. students に退塾予定日を追加
ALTER TABLE "public"."students"
  ADD COLUMN IF NOT EXISTS "withdrawal_date" DATE;

COMMENT ON COLUMN "public"."students"."withdrawal_date"
  IS '退塾予定日。この日以降のスケジュール生成・5週目計算から除外される。NULLは在籍中。';

-- 既に status='withdrawn' になっている生徒は updated_at を退塾日として推定（任意）
-- ※ 必要に応じて手動で正しい日付を入れ直すことを想定
UPDATE "public"."students"
SET "withdrawal_date" = ("updated_at" AT TIME ZONE 'Asia/Tokyo')::DATE
WHERE "status" = 'withdrawn'
  AND "withdrawal_date" IS NULL;
