-- ============================================================
-- 講師リリース準備(権限ハードニング): system_settings / admin_audit_logs を manager+ に
--
-- 越境(教室スコープ)の問題ではないが、authenticated USING(true) のままで
-- 講師が「アプリ設定の書き換え」「監査ログの閲覧」をできてしまう権限過大があった。
--
--   - system_settings: 設定値は全認証ユーザーが read する必要がある(getSystemSettings はブラウザ直読)
--       → SELECT は authenticated 全員に許可、書き込み(INSERT/UPDATE/DELETE)は manager+ のみ。
--   - admin_audit_logs: ユーザー作成/更新/削除等の監査ログ(actor/IP含む)。
--       書き込みは writeAuditLog が service-role(RLSバイパス)で行うため、RLSは manager+ のみに絞ってよい。
--       閲覧も manager+ のみ。
-- ============================================================

BEGIN;

-- ── system_settings ──
DROP POLICY IF EXISTS "system_settings_allow_all_auth" ON public.system_settings;

-- 閲覧: 全認証ユーザー(設定値の参照に必要)
CREATE POLICY "system_settings_select_auth" ON public.system_settings
  FOR SELECT TO authenticated
  USING (true);

-- 書き込み: manager+ のみ(FOR ALL だが SELECT は上のポリシーと OR されるので閲覧制限にはならない)
CREATE POLICY "system_settings_write_manager" ON public.system_settings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager')));

-- ── admin_audit_logs ──
DROP POLICY IF EXISTS "admin_audit_logs_auth_insert" ON public.admin_audit_logs;
DROP POLICY IF EXISTS "admin_audit_logs_auth_select" ON public.admin_audit_logs;

CREATE POLICY "admin_audit_logs_manager_all" ON public.admin_audit_logs
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager')));

COMMIT;
