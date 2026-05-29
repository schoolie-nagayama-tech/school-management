-- ============================================================
-- RLS 緊急修正: anon / public への無制限フルアクセスを剥奪する
-- ============================================================
--
-- 背景:
--   公開 anon キー（ブラウザバンドルに含まれ誰でも取得可能）に対し、
--   生徒・成績・指導ログ・面談・文字起こし等の機微テーブルが
--   FOR ALL USING(true) WITH CHECK(true) で開放されていた。
--   = ログイン不要で全教室の個人情報を read/insert/update/delete できる状態。
--
--   原因: xxx_rls_security_hardening.sql の DROP POLICY が実ポリシー名
--   （"Allow all for anon" 等）と不一致で空振りし、削除されていなかった。
--   加えて xxx_action_goals.sql 等で同じ危険パターンが再導入されていた。
--
-- 方針:
--   1. 公開ポータルが anon 直読する必要のないテーブルは anon/public のフル権限を削除
--      （authenticated 側ポリシーは存在を確認済み。スタッフアプリは影響なし）。
--   2. ポータルが anon SELECT で読むテーブル（forms / form_fields）は
--      FOR ALL を SELECT 限定に置換（書込・改ざん・削除のみ封鎖）。
--   3. schools / subjects / system_settings は別途 _anon_select が存在するため
--      フル権限のみ削除し SELECT は温存。
--
-- 適用順の注意:
--   マイグレーションはファイル名の辞書順で適用される。危険ポリシーを再導入する
--   xxx_*.sql より後に実行する必要があるため、本ファイルは zzz_ で始める。
--
-- 本マイグレーションで「触っていない」もの（別途要対応・破壊回避のため除外）:
--   - attendance_*           : ログイン不要の公開出欠ポータルが anon read/write を必要とする
--   - regular_shift_*        : 公開シフト提出フォームが anon read/write を必要とする
--   - seasonal_* / test_prep_*: 講習提案系。公開コマ申込フォームの読取要件を要確認
--   - user_profiles / user_schools / curriculum_items / textbooks の anon SELECT
--   これらは後続の修正で個別に（トークン化 / 教室スコープ化して）対応する。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 機微な生徒データ: anon フルアクセスを削除（authenticated ポリシーで継続動作）
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all for anon" ON public.students;
DROP POLICY IF EXISTS "Allow all for anon" ON public.assessments;
DROP POLICY IF EXISTS "Allow all for anon" ON public.assessment_scores;
DROP POLICY IF EXISTS "Allow all for anon" ON public.student_logs;
DROP POLICY IF EXISTS "Allow all for anon" ON public.student_subjects;
DROP POLICY IF EXISTS "action_goals_allow_all_anon" ON public.action_goals;
DROP POLICY IF EXISTS "progress_sessions_allow_all_anon" ON public.progress_sessions;
DROP POLICY IF EXISTS "student_textbook_exam_ranges_allow_all_anon" ON public.student_textbook_exam_ranges;

-- ------------------------------------------------------------
-- 2. 面談・文字起こし: 唯一のポリシーが {public} FOR ALL true のため
--    authenticated 限定に置換（anon/未ログインを排除。教室スコープ化は別途）
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Enable all access for all users" ON public.student_interviews;
CREATE POLICY "student_interviews_authenticated_all" ON public.student_interviews
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for all users" ON public.notta_transcripts;
CREATE POLICY "notta_transcripts_authenticated_all" ON public.notta_transcripts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- 3. マスタ系: フル権限のみ削除し、既存の anon SELECT は温存
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all for anon" ON public.schools;          -- schools_anon_select は残る
DROP POLICY IF EXISTS "Allow all for anon" ON public.subjects;         -- subjects_anon_select は残る
DROP POLICY IF EXISTS "system_settings_allow_all_anon" ON public.system_settings; -- system_settings_anon_select は残る

-- ------------------------------------------------------------
-- 4. フォーム定義: 公開ポータルが anon で SELECT するため SELECT 限定に置換
--    （書込・改ざん・削除を封鎖。回答 form_responses は service-role API 経由のみ）
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "forms_allow_all_anon" ON public.forms;
CREATE POLICY "forms_anon_select_published" ON public.forms
  FOR SELECT TO anon
  USING (status = 'published' AND is_archived = false);

DROP POLICY IF EXISTS "form_fields_allow_all_anon" ON public.form_fields;
CREATE POLICY "form_fields_anon_select" ON public.form_fields
  FOR SELECT TO anon USING (true);

-- ------------------------------------------------------------
-- 5. フォームテンプレート: 公開ポータルは読まない（スタッフ専用）。anon を完全削除
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "form_templates_allow_all_anon" ON public.form_templates;
DROP POLICY IF EXISTS "form_template_fields_allow_all_anon" ON public.form_template_fields;
