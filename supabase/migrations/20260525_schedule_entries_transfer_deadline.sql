-- 振替期限カラム追加
-- 背景：
--  - 振替（transferred_out）を作成したら、その振替を「いつまでに消化（transferred_in 確定）すべきか」を期限管理したい
--  - 運用ルール：振替期限 = 元の授業日付の **翌月末日**
--    例：2026-05-15 欠席 → 2026-06-30 までに振替先を確定
--  - 期限切れ間近の振替は、座席表セル上にチップ表示 + 督促ボードに集約

ALTER TABLE "public"."schedule_entries"
  ADD COLUMN IF NOT EXISTS "transfer_deadline" DATE;

COMMENT ON COLUMN "public"."schedule_entries"."transfer_deadline"
  IS '振替期限。transferred_out のエントリで使用し、元授業日の翌月末日を自動セット。transferred_in が確定すれば実質的に期限消化済みとなる。';

-- 期限切れ・期限間近の検索を高速化するインデックス
-- （status='transferred_out' かつ transfer_to_id IS NULL のエントリを期限順に絞り込む）
CREATE INDEX IF NOT EXISTS "idx_schedule_entries_transfer_deadline"
  ON "public"."schedule_entries" ("school_id", "transfer_deadline")
  WHERE "status" = 'transferred_out' AND "transfer_to_id" IS NULL;
