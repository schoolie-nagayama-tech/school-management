-- ============================================================
-- RLS 緊急修正 その3: user_invitations の anon 全件列挙を封鎖する
-- ============================================================
--
-- 背景:
--   "Anyone can view invitations by token" は FOR SELECT TO public USING(true)。
--   名前に反し条件が true のため、anon が「フィルタ無しの SELECT」で
--   全招待（トークン・宛先メール・付与ロール）を列挙できてしまっていた。
--
--   トークン照合はクエリ条件であり RLS ポリシーでは表現できない。そのため
--   招待受諾ページの読取をサービスロール API (/api/invite/[token]) に移し
--   （トークン一致の1件のみ返す）、本ポリシーを削除する。
--
--   管理側の "Admins can manage invitations"（check_user_role による ALL）は
--   そのまま残るため、スタッフの招待作成・一覧には影響しない。
-- ============================================================

DROP POLICY IF EXISTS "Anyone can view invitations by token" ON public.user_invitations;
