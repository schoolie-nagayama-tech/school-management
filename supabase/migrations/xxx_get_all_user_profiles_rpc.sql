-- user_profiles を全件取得する RPC（SECURITY DEFINER で RLS をバイパス）
CREATE OR REPLACE FUNCTION get_all_user_profiles()
RETURNS SETOF user_profiles
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM user_profiles ORDER BY created_at DESC;
$$;
