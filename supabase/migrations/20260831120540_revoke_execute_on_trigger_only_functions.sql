-- ============================================================
-- 本番適用済み（2026-08-31 / MCP apply_migration 経由）。db push で再適用しないこと。
-- ============================================================
-- 2026-08-31 の品質診断で発見: トリガ専用の関数が /rest/v1/rpc/<name> として anon からも
-- 呼び出せる状態になっていた（Supabase advisor の anon_security_definer_function_executable）。
--
-- トリガ関数は DML 実行時に「トリガの所有者権限」で動くため、呼び出しユーザーの EXECUTE 権限は
-- 不要。使い捨てのテーブル＋トリガで「EXECUTE を revoke しても authenticated からの INSERT で
-- トリガが正常発火する」ことを実測で確認済み。よって revoke してもトリガの動作には影響しない。
--
-- handle_new_user は「プロフィール自動作成廃止」（ログインしただけで teacher が生える穴の封鎖）で
-- 役目を終えているが、関数本体が残り anon に GRANT されたままだった。トリガ紐づけが0件であることを
-- 確認済み。DROP はせず EXECUTE を落とすに留める（本体は base_schema に残るので復元可能）。
--
-- ★ check_school_access / check_user_role / check_student_access は意図的に触らない。
--   これらは RLS ポリシー式から参照されており、呼び出しロールの EXECUTE を落とすと認可そのものが
--   壊れて全ユーザーがロックアウトされうる。advisor の警告は残るが、これは残して正しい。
-- ============================================================

revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.cascade_student_school_to_textbooks() from anon, authenticated;
revoke execute on function public.sync_student_textbook_school_id() from anon, authenticated;
revoke execute on function public.trg_send_form_notification() from anon, authenticated;
