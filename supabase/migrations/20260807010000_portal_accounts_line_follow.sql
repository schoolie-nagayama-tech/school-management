-- ============================================================
-- LINE友だち状態の追跡（ブロック/友だち解除を push 宛先から外すため）
--
-- 背景:
--   push は「友だちである」ことが前提。ブロックや友だち解除をされた相手に送っても
--   届かないうえ、無駄なAPI呼び出しとログを生む（通数として数えられる可能性もある）。
--   LINE は follow / unfollow を webhook で通知してくるので、それを受けて状態を持つ。
--
-- 既定を true にする理由:
--   ポータルアカウントは「LINEログイン＋友だち追加の同意画面」を通って作られる
--   （bot_prompt=aggressive）ため、作成直後は友だちである蓋然性が高い。
--   実際に外れたときは unfollow の webhook で false に落ちる。
--   ※ 友だちでない相手への送信は LINE 側でも失敗するので、ここは
--     「無駄打ちを減らす最適化」であって権限判定ではない。
-- ============================================================

alter table public.portal_accounts
add column if not exists line_followed boolean not null default true;

alter table public.portal_accounts
add column if not exists line_follow_updated_at timestamptz;

comment on column public.portal_accounts.line_followed is 'LINE公式アカウントを友だち追加中か。unfollow(ブロック/削除) webhook で false になる。push宛先の絞り込みに使う。';

comment on column public.portal_accounts.line_follow_updated_at is 'line_followed が最後に変化した時刻（follow/unfollow webhook 受信時）。';

-- push 宛先の解決で「連携済みかつ友だち」を引くための部分索引。
create index if not exists idx_portal_accounts_line_active on public.portal_accounts (line_user_id)
where
  line_user_id is not null
  and line_followed;
