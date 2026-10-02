-- ============================================================
-- セキュリティ総点検（2026-09-30）追補: 権限判定の関数を anon から外す
-- ============================================================
--
-- ■ なぜ
--   20260930120000 で足した判定関数は `revoke all ... from public` のあと authenticated と
--   service_role にだけ EXECUTE を付けたつもりだったが、Supabase の既定権限
--   （ALTER DEFAULT PRIVILEGES）で anon にも EXECUTE が直接付いていた。
--   本番適用後の Security Advisor（anon_security_definer_function_executable）で判明。
--   特に user_role_level(uuid) は、未ログインでも任意のユーザーIDの権限の高さを返してしまう。
--
-- ■ 影響
--   これらの関数を使うポリシーはすべて `to authenticated` なので、anon から外しても画面は変わらない。
--   トリガー（guard_*）も anon が書ける表には付いていない。
--   ★authenticated からは外さないこと。RLS の評価は呼び出したユーザーの権限で関数を実行するので、
--     外すと講師・教室長の画面がすべて permission denied になる。
--
-- ■ 本番への適用: Supabase MCP の apply_migration（db push は使わない）。
-- ============================================================

revoke execute on function public.role_level(text) from anon;
revoke execute on function public.auth_role_level() from anon;
revoke execute on function public.user_role_level(uuid) from anon;
revoke execute on function public.is_staff() from anon;
revoke execute on function public.is_trusted_db_caller() from anon;
