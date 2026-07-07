-- 問合せ追客メールの配信停止（オプトアウト）機構。
--
-- 特定電子メール法では、問合せ元（自らメールアドレスを通知した相手）への
-- 追客メールは事前同意の例外にあたるが、広告宣伝を含む場合は
--   1) メール本文に配信停止の申出方法を明記
--   2) 送信者情報の表示
--   3) 配信停止の意思表示があった相手には以後送らない
-- が必要になる。本マイグレーションは 3) を担保するためのフラグと、
-- メールに埋め込むワンクリック配信停止リンク用のトークンを追加する。

alter table public.inquiries
  -- 配信停止フラグ。true の宛先には追客メールを送らない（送信フローで一律除外）。
  add column if not exists email_opt_out boolean not null default false,
  -- 配信停止が行われた日時（監査・表示用）。
  add column if not exists email_opt_out_at timestamptz,
  -- 配信停止の経路。'unsubscribe_link'（メール内リンク）/ 'manual'（管理画面で手動）。
  add column if not exists email_opt_out_source text,
  -- ワンクリック配信停止リンクに載せる推測不能なトークン。
  -- 既存行にも gen_random_uuid()（volatile）で行ごとに一意な値が入る。
  add column if not exists email_opt_out_token uuid not null default gen_random_uuid();

-- トークンは公開URLの照合キーなので一意にする。
create unique index if not exists inquiries_email_opt_out_token_key
  on public.inquiries (email_opt_out_token);

comment on column public.inquiries.email_opt_out is '追客メールの配信停止フラグ。true の宛先には送信しない。';
comment on column public.inquiries.email_opt_out_token is 'メール内ワンクリック配信停止リンクの照合トークン（公開・推測不能）。';
