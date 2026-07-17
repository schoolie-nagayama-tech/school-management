-- 2026-07-14 send-form-notification Webhook の認証情報を Vault へ移行(2/2: トリガー関数差し替え)
--
-- supabase_functions.http_request は Database Webhooks 用の組み込みトリガー関数で、
-- url/method/headers/params は CREATE TRIGGER 時にリテラル引数として焼き込まれる仕様のため、
-- 実行時に Vault を参照するには使えない。そのため net.http_post を直接呼ぶ自前のトリガー関数に
-- 置き換え、Authorization ヘッダーは呼び出しの都度 vault.decrypted_secrets から読む。
--
-- ペイロード形式(type/table/schema/record/old_record)は supabase_functions.http_request が
-- 送っていたものと同一にし、send-form-notification 側(body.record を参照)の実装は変更不要。
--
-- URL は現行本番(東京: bniistrbylypnwpfqszb)の Functions エンドポイントに合わせている。
-- 注意: base_schema.sql の組み込みトリガーは旧シンガポール(mzxysqkuuxcfffwlfsvj)の URL/JWT を
-- 残したままで実態(東京)と乖離している。base_schema 側の是正は別タスク。

create or replace function public.trg_send_form_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  auth_token text;
  payload jsonb;
begin
  select decrypted_secret into auth_token
  from vault.decrypted_secrets
  where name = 'form_notification_auth_token';

  if auth_token is null or auth_token = 'REPLACE_ME_VIA_DASHBOARD_OR_CLI' then
    raise warning 'form_notification_auth_token が Vault に未設定のため send-form-notification Webhook をスキップしました (form_responses.id=%)', NEW.id;
    return NEW;
  end if;

  payload := jsonb_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', to_jsonb(NEW),
    'old_record', null
  );

  perform net.http_post(
    url := 'https://bniistrbylypnwpfqszb.supabase.co/functions/v1/send-form-notification',
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || auth_token
    ),
    timeout_milliseconds := 5000
  );

  return NEW;
end;
$$;

revoke all on function public.trg_send_form_notification() from public;

create or replace trigger "send-form-notification"
after insert on public.form_responses
for each row
execute function public.trg_send_form_notification();
