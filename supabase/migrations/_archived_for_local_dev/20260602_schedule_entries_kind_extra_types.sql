-- 追加授業（単発の手動配置コマ）の3種別を schedule_entries.kind に許可する。
--
-- これまで kind は 'regular'（通常授業＝通塾日程から自動生成）と
-- 'koushu'（講習）の2値だった。座席表の空きセルから室長が単発で配置する
-- 「追加授業」を扱えるよう、次の3種別を追加する:
--   - test_prep  : テスト対策
--   - additional : 追加授業
--   - trial      : 体験授業
--
-- これらは通塾日程(schedule_regular_patterns)を持たない単発コマ（regular_pattern_id=NULL）で、
-- 週次再生成(generateWeeklySchedule)では削除されない（kind='regular' のみ削除対象のため保護される）。
ALTER TABLE "public"."schedule_entries"
  DROP CONSTRAINT IF EXISTS "schedule_entries_kind_check";
ALTER TABLE "public"."schedule_entries"
  ADD CONSTRAINT "schedule_entries_kind_check"
  CHECK ("kind" IN ('regular', 'koushu', 'test_prep', 'additional', 'trial'));
