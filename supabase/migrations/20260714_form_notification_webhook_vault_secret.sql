-- 2026-07-14 send-form-notification Webhook の認証情報を Vault へ移行(1/2: シークレット登録)
--
-- 背景: 00000000000000_base_schema.sql の "send-form-notification" トリガーは
-- supabase_functions.http_request(組み込みDatabase Webhooksヘルパー)を使っており、
-- Authorization ヘッダー(service_role JWT, legacy JWT secretで署名)がマイグレーションSQLに
-- 平文でハードコードされている。legacy JWT secretを将来無効化すると、このWebhookだけ
-- 静かに動作しなくなる(フォーム申込通知メールが送信されなくなる)。
--
-- ここでは実際のキー値はコミットしない(プレースホルダーのみ登録)。
-- 適用後、各環境(ローカルdocker/本番)で1回だけ以下を手動実行してキーを差し替えること:
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'form_notification_auth_token'),
--     '<実際の service_role JWT または sb_secret_... >'
--   );
--
-- 値を差し替えるまでは Webhook は認証エラーになる(次のマイグレーションのトリガー関数は
-- シークレット未設定時に警告を出してスキップする実装のため、INSERT自体は失敗しない)。

do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'form_notification_auth_token'
  ) then
    perform vault.create_secret(
      'REPLACE_ME_VIA_DASHBOARD_OR_CLI',
      'form_notification_auth_token',
      'send-form-notification Webhook (public.form_responses AFTER INSERT) の Authorization ヘッダー用。適用後に vault.update_secret で実際の値に差し替えること。'
    );
  end if;
end $$;
