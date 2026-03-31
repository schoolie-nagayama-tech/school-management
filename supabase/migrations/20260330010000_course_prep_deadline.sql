-- 進捗管理項目に期日カラムを追加
ALTER TABLE course_prep_progress_items ADD COLUMN IF NOT EXISTS deadline DATE;

-- 進捗管理項目に自動計算ソースを追加（通常週回数や講習回数の自動取得用）
ALTER TABLE course_prep_progress_items ADD COLUMN IF NOT EXISTS auto_source TEXT CHECK (auto_source IN ('regular_weekly', 'course_sessions'));
