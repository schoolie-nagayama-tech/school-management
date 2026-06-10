-- ============================================================
-- 公開フォームの科目プルダウンを復旧する（anon SELECT を再付与）
-- ============================================================
--
-- 背景:
--   2026-06-09 の zzz_20260609_drop_unused_anon_public_select_policies.sql で
--   「公開フォームは subjects を読まない」という前提のもと subjects_anon_select を
--   削除した。しかしこの前提は誤りで、公開ポータルの以下2フォームは
--   getSubjects()（@/lib/supabase の anon クライアント）で subjects を直接読む:
--     - 週回数変更フォーム  src/components/forms/youbi/YoubiForm.tsx
--     - 増コマフォーム      src/components/forms/shukaisu/ShukaisuForm.tsx
--   このため未ログインの実機（Safari等）では科目プルダウンが空になっていた
--   （管理者プレビューは authenticated で読めるため気付きにくかった）。
--
-- 安全性:
--   subjects は科目名・学年区分・コマ長のみで個人情報を含まない公開マスタ。
--   schools / schedule_time_slots と同様に anon SELECT を許可する公開マスタとして扱う
--   （cf. zzz_20260602_schedule_time_slots_anon_read.sql に同じ方針を明記）。
--   書込はスタッフ(authenticated)のみで据え置き。
-- ============================================================

DROP POLICY IF EXISTS "subjects_anon_select" ON public.subjects;
CREATE POLICY "subjects_anon_select" ON public.subjects
  FOR SELECT TO anon
  USING (true);
