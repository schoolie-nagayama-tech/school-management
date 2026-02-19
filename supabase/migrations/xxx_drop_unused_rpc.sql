-- =============================================
-- SECURITY DEFINER RPC の削除
-- T1-1 で API 認証 + Service Role Key 経由に移行済みのため不要
-- =============================================

-- 1. get_all_user_profiles: フロントエンドから呼ばれていない
DROP FUNCTION IF EXISTS get_all_user_profiles();

-- 2. update_teacher_profile: API Route で直接 UPDATE に変更済み
--    引数違いの2バージョンがあるため両方削除
DROP FUNCTION IF EXISTS update_teacher_profile(UUID, TEXT, UUID[], INTEGER[]);
DROP FUNCTION IF EXISTS update_teacher_profile(UUID, TEXT, UUID[], INTEGER[], JSONB);
