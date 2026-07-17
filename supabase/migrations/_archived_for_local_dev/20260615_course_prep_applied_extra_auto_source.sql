-- 講習進捗の自動集計列に 'applied_extra'（申込増コマ）を追加
-- proposed_extra（提示増コマ = 提案コマ合計 - 通常回数）に対し、
-- applied_extra は申込コマ（seasonal_proposal_units.applied_koma）合計 - 通常回数。
-- 提案書で「提案済み」にして入力した申込コマを進捗ダッシュボードの取得率に直結させる。
ALTER TABLE course_prep_progress_items
  DROP CONSTRAINT IF EXISTS course_prep_progress_items_auto_source_check;

ALTER TABLE course_prep_progress_items
  ADD CONSTRAINT course_prep_progress_items_auto_source_check
  CHECK (auto_source IN ('regular_weekly', 'course_sessions', 'proposed_extra', 'subject_proposal', 'applied_extra'));
