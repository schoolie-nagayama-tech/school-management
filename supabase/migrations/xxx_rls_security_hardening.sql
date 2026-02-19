-- =============================================
-- RLS セキュリティ強化（Phase 1: anon deny-by-default）
-- 実行日: 2026-02-19
--
-- 方針:
--   anon の FOR ALL ポリシーを全テーブルから削除し、
--   保護者ポータル・講師シフト申請に必要な最小権限のみ付与する。
--   authenticated のポリシーは変更しない（Phase 2で対応）。
-- =============================================

BEGIN;

-- =============================================
-- 1. 生徒・成績関連（anon アクセス完全禁止）
-- =============================================
DROP POLICY IF EXISTS "students_allow_all_anon" ON students;
DROP POLICY IF EXISTS "student_logs_allow_all_anon" ON student_logs;
DROP POLICY IF EXISTS "student_subjects_allow_all_anon" ON student_subjects;
DROP POLICY IF EXISTS "assessments_allow_all_anon" ON assessments;
DROP POLICY IF EXISTS "assessment_scores_allow_all_anon" ON assessment_scores;

-- =============================================
-- 2. 申込・管理関連（anon アクセス禁止）
-- =============================================
DROP POLICY IF EXISTS "application_items_allow_all_anon" ON application_items;
DROP POLICY IF EXISTS "student_applications_allow_all_anon" ON student_applications;

-- =============================================
-- 3. 掲示板関連（anon アクセス禁止）
-- =============================================
DROP POLICY IF EXISTS "bulletin_labels_allow_all_anon" ON bulletin_labels;
DROP POLICY IF EXISTS "bulletin_posts_allow_all_anon" ON bulletin_posts;
DROP POLICY IF EXISTS "bulletin_reads_allow_all_anon" ON bulletin_reads;

-- =============================================
-- 4. 進捗管理関連（anon アクセス禁止）
-- =============================================
DROP POLICY IF EXISTS "exam_types_allow_all_anon" ON exam_types;
DROP POLICY IF EXISTS "textbooks_allow_all_anon" ON textbooks;
DROP POLICY IF EXISTS "curriculum_items_allow_all_anon" ON curriculum_items;
DROP POLICY IF EXISTS "student_textbooks_allow_all_anon" ON student_textbooks;
DROP POLICY IF EXISTS "student_textbook_settings_allow_all_anon" ON student_textbook_settings;
DROP POLICY IF EXISTS "student_textbook_exams_allow_all_anon" ON student_textbook_exams;
DROP POLICY IF EXISTS "student_progress_allow_all_anon" ON student_progress;
DROP POLICY IF EXISTS "student_progress_lessons_allow_all_anon" ON student_progress_lessons;

-- =============================================
-- 5. その他（anon アクセス禁止）
-- =============================================
DROP POLICY IF EXISTS "alert_dismissals_allow_all_anon" ON alert_dismissals;
DROP POLICY IF EXISTS "user_profiles_allow_all_anon" ON user_profiles;
DROP POLICY IF EXISTS "user_schools_allow_all_anon" ON user_schools;
DROP POLICY IF EXISTS "student_interviews_allow_all_anon" ON student_interviews;

-- =============================================
-- 6. schools: anon ALL → anon SELECT のみ
-- =============================================
DROP POLICY IF EXISTS "schools_allow_all_anon" ON schools;
CREATE POLICY "schools_anon_select" ON schools
  FOR SELECT TO anon USING (true);

-- =============================================
-- 7. subjects: anon ALL → anon SELECT のみ
-- =============================================
DROP POLICY IF EXISTS "subjects_allow_all_anon" ON subjects;
CREATE POLICY "subjects_anon_select" ON subjects
  FOR SELECT TO anon USING (true);

-- =============================================
-- 8. portal_menu: anon ALL → anon SELECT (is_visible=true) のみ
-- =============================================
DROP POLICY IF EXISTS "portal_menu_allow_all_anon" ON portal_menu;
CREATE POLICY "portal_menu_anon_select" ON portal_menu
  FOR SELECT TO anon USING (is_visible = true);

-- =============================================
-- 9. system_settings: anon ALL → anon SELECT のみ
-- =============================================
DROP POLICY IF EXISTS "system_settings_allow_all_anon" ON system_settings;
CREATE POLICY "system_settings_anon_select" ON system_settings
  FOR SELECT TO anon USING (true);

-- =============================================
-- 10. form_periods / form_responses のanon ポリシー
-- form_periods: 公開期間内の SELECT のみ許可（is_active ではなく publish_start/end で判定）
-- form_responses: anon INSERT のみ（xxx_portal_and_forms.sql で設定済みの想定）
-- FOR ALL の anon ポリシーが存在する場合のみ削除
-- =============================================
DROP POLICY IF EXISTS "form_periods_allow_all_anon" ON form_periods;
DROP POLICY IF EXISTS "form_responses_allow_all_anon" ON form_responses;

-- form_periods: 修正版（is_archived 条件、is_active 非依存）
DROP POLICY IF EXISTS "form_periods_allow_select_anon" ON form_periods;
CREATE POLICY "form_periods_allow_select_anon" ON form_periods
  FOR SELECT TO anon USING (
    (is_archived IS NULL OR is_archived = false)
    AND (publish_start IS NULL OR publish_start <= NOW())
    AND (publish_end IS NULL OR publish_end >= NOW())
  );

-- =============================================
-- 11. seasonal_shift_* は既存ポリシーを維持
-- 以下は変更不要（確認コメントのみ）:
--   seasonal_shift_settings: anon SELECT (published) → OK
--   seasonal_shift_closed_dates: anon SELECT → OK
--   seasonal_shift_submissions: anon INSERT/SELECT/UPDATE → OK
--   seasonal_shift_submission_slots: anon INSERT/SELECT/UPDATE/DELETE → OK
--   seasonal_shift_slot_settings: anon SELECT → OK
-- =============================================

COMMIT;
