-- ============================================================
-- 講師リリース準備①(テールF): 公開フロー依存テーブルの是正
--
-- 調査で確認:
--   - 公開シフト(/api/regular-shift/public, /api/seasonal-shift/public)は service-role 書込
--     ＝RLSバイパスのため、slot子テーブルを authenticated にしても公開フォームは壊れない。
--   - user_schools を匿名ブラウザで読む箇所は無い（公開ページ.tsx ヒット0）。
--   - form_fields はポータル(匿名)が参照するため anon SELECT は温存し authenticated 側のみ絞る。
--
-- slot/form 子は親(scope済)経由で check_school_access(parent.school_id) に統一。
-- user_schools の匿名全件SELECT（staff↔校マッピング漏洩）を削除（本人/管理者ポリシーは温存）。
-- ============================================================

BEGIN;

-- form_fields (form_id -> forms.school_id) ※ anon SELECT は温存、authenticated ALL のみ絞る
DROP POLICY IF EXISTS "form_fields_allow_all_auth" ON public.form_fields;
CREATE POLICY "form_fields_school_scope_auth" ON public.form_fields FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.forms f WHERE f.id=form_fields.form_id AND public.check_school_access(f.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.forms f WHERE f.id=form_fields.form_id AND public.check_school_access(f.school_id)));

-- form_template_fields (template_id -> form_templates.school_id)
DROP POLICY IF EXISTS "form_template_fields_allow_all_auth" ON public.form_template_fields;
CREATE POLICY "form_template_fields_school_scope_auth" ON public.form_template_fields FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.form_templates t WHERE t.id=form_template_fields.template_id AND public.check_school_access(t.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.form_templates t WHERE t.id=form_template_fields.template_id AND public.check_school_access(t.school_id)));

-- regular_shift_slot_settings (setting_id -> regular_shift_settings.school_id)
DROP POLICY IF EXISTS "regular_shift_slot_settings_auth" ON public.regular_shift_slot_settings;
CREATE POLICY "regular_shift_slot_settings_school_scope_auth" ON public.regular_shift_slot_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.regular_shift_settings s WHERE s.id=regular_shift_slot_settings.setting_id AND public.check_school_access(s.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.regular_shift_settings s WHERE s.id=regular_shift_slot_settings.setting_id AND public.check_school_access(s.school_id)));

-- regular_shift_submission_slots (submission_id -> regular_shift_submissions.school_id)
DROP POLICY IF EXISTS "regular_shift_slots_auth" ON public.regular_shift_submission_slots;
CREATE POLICY "regular_shift_submission_slots_school_scope_auth" ON public.regular_shift_submission_slots FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.regular_shift_submissions p WHERE p.id=regular_shift_submission_slots.submission_id AND public.check_school_access(p.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.regular_shift_submissions p WHERE p.id=regular_shift_submission_slots.submission_id AND public.check_school_access(p.school_id)));

-- seasonal_shift_slot_settings (setting_id -> seasonal_shift_settings.school_id)
DROP POLICY IF EXISTS "seasonal_shift_slot_settings_auth" ON public.seasonal_shift_slot_settings;
CREATE POLICY "seasonal_shift_slot_settings_school_scope_auth" ON public.seasonal_shift_slot_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.seasonal_shift_settings s WHERE s.id=seasonal_shift_slot_settings.setting_id AND public.check_school_access(s.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.seasonal_shift_settings s WHERE s.id=seasonal_shift_slot_settings.setting_id AND public.check_school_access(s.school_id)));

-- seasonal_shift_submission_slots (submission_id -> seasonal_shift_submissions.school_id)
DROP POLICY IF EXISTS "seasonal_shift_slots_auth" ON public.seasonal_shift_submission_slots;
CREATE POLICY "seasonal_shift_submission_slots_school_scope_auth" ON public.seasonal_shift_submission_slots FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.seasonal_shift_submissions p WHERE p.id=seasonal_shift_submission_slots.submission_id AND public.check_school_access(p.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.seasonal_shift_submissions p WHERE p.id=seasonal_shift_submission_slots.submission_id AND public.check_school_access(p.school_id)));

-- seasonal_shift_student_submission_slots (submission_id -> seasonal_shift_student_submissions.school_id)
DROP POLICY IF EXISTS "seasonal_shift_student_submission_slots_allow_all_auth" ON public.seasonal_shift_student_submission_slots;
CREATE POLICY "seasonal_shift_student_submission_slots_school_scope_auth" ON public.seasonal_shift_student_submission_slots FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.seasonal_shift_student_submissions p WHERE p.id=seasonal_shift_student_submission_slots.submission_id AND public.check_school_access(p.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.seasonal_shift_student_submissions p WHERE p.id=seasonal_shift_student_submission_slots.submission_id AND public.check_school_access(p.school_id)));

-- user_schools: 匿名全件SELECT を削除（本人/管理者ポリシーは温存）
DROP POLICY IF EXISTS "Anyone can view user_schools for attendance portal" ON public.user_schools;

COMMIT;
