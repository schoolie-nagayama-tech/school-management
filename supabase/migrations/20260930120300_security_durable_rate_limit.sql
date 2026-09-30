-- ============================================================
-- セキュリティ総点検（2026-09-30）: 回数制限を DB で数える
-- ============================================================
--
-- ■ なぜ
--   src/lib/utils/rateLimit.ts はサーバーのメモリ内の Map で数えていた。Vercel では
--   リクエストごとに別のインスタンスに振られ、再起動でも消えるので、実質ほとんど効いていなかった。
--   保護者ログインの総当たり、生徒コード（S0001 形式）の総当たりによる子どもの氏名の列挙、
--   公開フォームの大量送信が、どれも止まらない状態だった。
--   追加の契約なしで済むよう、既存の Supabase に回数を記録する（ユーザー判断 2026-09-30）。
--
-- ■ 仕組み
--   固定窓のカウンタ。rate_limit_hit(バケット, キー, 上限, 窓秒) を呼ぶと、その窓の回数を1増やし、
--   上限以内なら true を返す。キーは呼び出し側で SHA-256 にしてから渡す（IP やログインIDを
--   そのまま DB に残さないため）。古い行は関数の中でときどき掃除する（専用の cron を増やさない）。
--
-- ■ 権限
--   サーバー（service role）だけが呼べる。anon / authenticated / portal からは表も関数も触れない
--   （触れると他人のカウンタを消して制限を外したり、他人を締め出したりできてしまう）。
--
-- ■ 本番への適用: Supabase MCP の apply_migration（db push は使わない）。
-- ============================================================

create table if not exists public.rate_limit_counters (
  bucket text not null,
  key_hash text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, key_hash, window_start)
);

comment on table public.rate_limit_counters is
  '回数制限のカウンタ（固定窓）。key_hash は IP・ログインIDの SHA-256。service role 専用';

alter table public.rate_limit_counters enable row level security;
revoke all on table public.rate_limit_counters from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'portal') then
    execute 'revoke all on table public.rate_limit_counters from portal';
  end if;
end $$;
grant select, insert, update, delete on table public.rate_limit_counters to service_role;

create or replace function public.rate_limit_hit(
  p_bucket text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_hits integer;
begin
  if p_window_seconds <= 0 or p_limit <= 0 then
    return true;
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_counters as c (bucket, key_hash, window_start, hits)
  values (p_bucket, p_key_hash, v_window_start, 1)
  on conflict (bucket, key_hash, window_start)
  do update set hits = c.hits + 1
  returning c.hits into v_hits;

  -- 掃除: 約100回に1回、1日より古い窓を消す（行が増え続けないように）
  if random() < 0.01 then
    delete from public.rate_limit_counters where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;

revoke all on function public.rate_limit_hit(text, text, integer, integer) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'portal') then
    execute 'revoke all on function public.rate_limit_hit(text, text, integer, integer) from portal';
  end if;
end $$;
grant execute on function public.rate_limit_hit(text, text, integer, integer) to service_role;
