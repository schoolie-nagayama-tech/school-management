-- ============================================================
-- Phase 2: RLS school_id スコープ化
-- 認証済みユーザーの行アクセスを check_school_access(school_id) でスコープ化
--
-- 影響:
--   admin/owner/manager → 変更なし（check_school_access で全アクセス許可）
--   teacher → 所属教室(user_schools)のデータのみアクセス可能
--
-- 触らないもの:
--   - anon ポリシー（保護者ポータル・シフト公開フォーム等）
--   - school_id を持たないテーブル（subjects, textbooks 等のマスタデータ）
--   - user_profiles, user_schools（既存の auth.uid() ベースのポリシー）
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 0. check_student_access を修正（admin のみ → admin/owner/manager に拡張）
--    check_school_access と同じロール階層に合わせる
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_student_access(student_school_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role
  FROM user_profiles
  WHERE id = auth.uid();

  IF user_role IN ('admin', 'owner', 'manager') THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM user_schools us
    WHERE us.user_id = auth.uid()
    AND us.school_id = student_school_id
  );
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 1. schools テーブル
--    既存の check_school_access(id) ポリシーを残し、
--    permissive な USING(true) ポリシーのみ削除
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.schools;
DROP POLICY IF EXISTS "schools_allow_all_auth" ON public.schools;

-- check_school_access(id) を使った FOR ALL ポリシーに統一
-- 既存の "Users can access their schools" は USING のみで WITH CHECK がないため、
-- 一旦削除して WITH CHECK 付きで再作成
DROP POLICY IF EXISTS "Users can access their schools" ON public.schools;
CREATE POLICY "schools_school_scope_auth"
  ON public.schools FOR ALL TO authenticated
  USING (public.check_school_access(id))
  WITH CHECK (public.check_school_access(id));

-- ────────────────────────────────────────────────────────────
-- 2. students テーブル
--    既存の check_student_access ポリシーを残し、permissive 削除
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.students;
DROP POLICY IF EXISTS "students_allow_all_auth" ON public.students;

DROP POLICY IF EXISTS "Users can access students in their schools" ON public.students;
CREATE POLICY "students_school_scope_auth"
  ON public.students FOR ALL TO authenticated
  USING (public.check_student_access(school_id))
  WITH CHECK (public.check_student_access(school_id));

-- ────────────────────────────────────────────────────────────
-- 3. 成績・評価
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.assessments;
DROP POLICY IF EXISTS "assessments_allow_all_auth" ON public.assessments;
CREATE POLICY "assessments_school_scope_auth"
  ON public.assessments FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "exam_types_allow_all_auth" ON public.exam_types;
CREATE POLICY "exam_types_school_scope_auth"
  ON public.exam_types FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- ────────────────────────────────────────────────────────────
-- 4. 生徒関連
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.student_logs;
DROP POLICY IF EXISTS "student_logs_allow_all_auth" ON public.student_logs;
DROP POLICY IF EXISTS "student_logs_insert_authenticated" ON public.student_logs;
DROP POLICY IF EXISTS "student_logs_select_authenticated" ON public.student_logs;
CREATE POLICY "student_logs_school_scope_auth"
  ON public.student_logs FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "student_applications_allow_all_auth" ON public.student_applications;
CREATE POLICY "student_applications_school_scope_auth"
  ON public.student_applications FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "student_billings_allow_all_auth" ON public.student_billings;
CREATE POLICY "student_billings_school_scope_auth"
  ON public.student_billings FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "student_textbooks_allow_all_auth" ON public.student_textbooks;
CREATE POLICY "student_textbooks_school_scope_auth"
  ON public.student_textbooks FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- ────────────────────────────────────────────────────────────
-- 5. 請求
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "billing_items_allow_all_auth" ON public.billing_items;
CREATE POLICY "billing_items_school_scope_auth"
  ON public.billing_items FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "billing_periods_allow_all_auth" ON public.billing_periods;
CREATE POLICY "billing_periods_school_scope_auth"
  ON public.billing_periods FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- ────────────────────────────────────────────────────────────
-- 6. 掲示板
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "bulletin_labels_allow_all_auth" ON public.bulletin_labels;
CREATE POLICY "bulletin_labels_school_scope_auth"
  ON public.bulletin_labels FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "bulletin_posts_allow_all_auth" ON public.bulletin_posts;
CREATE POLICY "bulletin_posts_school_scope_auth"
  ON public.bulletin_posts FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- ────────────────────────────────────────────────────────────
-- 7. フォーム（anon ポリシーは触らない）
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "form_periods_allow_all_auth" ON public.form_periods;
CREATE POLICY "form_periods_school_scope_auth"
  ON public.form_periods FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "form_responses_allow_all_auth" ON public.form_responses;
CREATE POLICY "form_responses_school_scope_auth"
  ON public.form_responses FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "form_templates_allow_all_auth" ON public.form_templates;
CREATE POLICY "form_templates_school_scope_auth"
  ON public.form_templates FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "forms_allow_all_auth" ON public.forms;
CREATE POLICY "forms_school_scope_auth"
  ON public.forms FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- ────────────────────────────────────────────────────────────
-- 8. 教材・発注・在庫
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "materials_allow_all_auth" ON public.materials;
CREATE POLICY "materials_school_scope_auth"
  ON public.materials FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "orders_allow_all_auth" ON public.material_orders;
CREATE POLICY "material_orders_school_scope_auth"
  ON public.material_orders FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "stock_txns_allow_all_auth" ON public.material_stock_transactions;
CREATE POLICY "material_stock_txns_school_scope_auth"
  ON public.material_stock_transactions FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- ────────────────────────────────────────────────────────────
-- 9. スケジュール
--    schedule_closed_days は school_id が NULL のレコード（全教室共通）も許可
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "schedule_entries_allow_all_auth" ON public.schedule_entries;
CREATE POLICY "schedule_entries_school_scope_auth"
  ON public.schedule_entries FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "schedule_closed_days_allow_all_auth" ON public.schedule_closed_days;
CREATE POLICY "schedule_closed_days_school_scope_auth"
  ON public.schedule_closed_days FOR ALL TO authenticated
  USING (school_id IS NULL OR public.check_school_access(school_id))
  WITH CHECK (school_id IS NULL OR public.check_school_access(school_id));

DROP POLICY IF EXISTS "schedule_generation_logs_allow_all_auth" ON public.schedule_generation_logs;
CREATE POLICY "schedule_generation_logs_school_scope_auth"
  ON public.schedule_generation_logs FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "schedule_regular_patterns_allow_all_auth" ON public.schedule_regular_patterns;
CREATE POLICY "schedule_regular_patterns_school_scope_auth"
  ON public.schedule_regular_patterns FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "schedule_time_slots_allow_all_auth" ON public.schedule_time_slots;
CREATE POLICY "schedule_time_slots_school_scope_auth"
  ON public.schedule_time_slots FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- ────────────────────────────────────────────────────────────
-- 10. その他（embed, alert, application_items, monthly_task, portal_menu）
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "embed_tokens_select" ON public.embed_tokens;
DROP POLICY IF EXISTS "embed_tokens_insert" ON public.embed_tokens;
DROP POLICY IF EXISTS "embed_tokens_update" ON public.embed_tokens;
DROP POLICY IF EXISTS "embed_tokens_delete" ON public.embed_tokens;
CREATE POLICY "embed_tokens_school_scope_auth"
  ON public.embed_tokens FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "alert_dismissals_allow_all_auth" ON public.alert_dismissals;
CREATE POLICY "alert_dismissals_school_scope_auth"
  ON public.alert_dismissals FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "application_items_allow_all_auth" ON public.application_items;
CREATE POLICY "application_items_school_scope_auth"
  ON public.application_items FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "authenticated users can manage overrides" ON public.monthly_task_overrides;
CREATE POLICY "monthly_task_overrides_school_scope_auth"
  ON public.monthly_task_overrides FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "portal_menu_allow_all_auth" ON public.portal_menu;
CREATE POLICY "portal_menu_school_scope_auth"
  ON public.portal_menu FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- ────────────────────────────────────────────────────────────
-- 11. シフトテーブル（authenticated ポリシーのみ変更、anon は不変）
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "regular_shift_settings_auth" ON public.regular_shift_settings;
CREATE POLICY "regular_shift_settings_school_scope_auth"
  ON public.regular_shift_settings FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "regular_shift_submissions_auth" ON public.regular_shift_submissions;
CREATE POLICY "regular_shift_submissions_school_scope_auth"
  ON public.regular_shift_submissions FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "seasonal_shift_settings_auth" ON public.seasonal_shift_settings;
CREATE POLICY "seasonal_shift_settings_school_scope_auth"
  ON public.seasonal_shift_settings FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS "seasonal_shift_submissions_auth" ON public.seasonal_shift_submissions;
-- seasonal_shift_submissions は後の migration で manager/teacher 分離ポリシーあり
-- そちらも school スコープ化
DROP POLICY IF EXISTS "seasonal_shift_submissions_manager_all" ON public.seasonal_shift_submissions;
DROP POLICY IF EXISTS "seasonal_shift_submissions_teacher_own" ON public.seasonal_shift_submissions;
CREATE POLICY "seasonal_shift_submissions_school_scope_auth"
  ON public.seasonal_shift_submissions FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

COMMIT;
