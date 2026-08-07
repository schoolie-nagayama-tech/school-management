-- ============================================================
-- LINE送信ログ（通数＝コスト管理の台帳）
--
-- 背景（docs/account-line-design.md §6）:
--   LINE Messaging API の課金は「送信人数 × 配信回数」。プラン選択（ライト¥5,000 /
--   スタンダード¥15,000）は月間通数で決まり、想定を下回れば後からライトへ落とせる。
--   その判断には**実測の通数**が要る。送信のたびにここへ1行残す。
--
-- 記録するのは「何通ぶん課金されたか」であって本文ではない:
--   本文は保護者への連絡内容そのもの（＝機微）。コスト管理に不要なので保存しない。
--
-- status の意味:
--   sent    … 実際にLINEへ送信した（課金対象）
--   dry_run … LINE_PUSH_ENABLED が未設定のため送信せずログだけ残した（課金なし）
--   skipped … 宛先ゼロ・ダミーデータ等で送信しなかった（課金なし）
--   error   … 送信を試みて失敗した（課金は不明。detail に理由）
-- ============================================================

create table if not exists public.line_message_logs (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,                                   -- NotifyKind（report_published 等）
  student_id      uuid references public.students(id) on delete set null,
  recipient_count integer not null default 0,                      -- 宛先の人数
  message_count   integer not null default 0,                      -- 課金対象の通数（人数×メッセージ数）
  status          text not null check (status in ('sent', 'dry_run', 'skipped', 'error')),
  detail          text,                                            -- エラー理由・スキップ理由
  created_at      timestamptz not null default now()
);

comment on table public.line_message_logs is 'LINE送信の通数ログ（コスト管理用）。本文は保存しない。';
comment on column public.line_message_logs.message_count is '課金対象の通数（宛先人数×メッセージ数）。status=sent のみ実課金。';

-- 月次集計（「今月何通使ったか」）を引くための索引。
create index if not exists idx_line_message_logs_created on public.line_message_logs (created_at desc);

-- ------------------------------------------------------------
-- 権限: service role 専用（アプリのディスパッチャだけが書く）
--   保護者（portal ロール）にもスタッフ（authenticated）にも触らせない。
--   RLS を有効にしつつポリシーを1つも作らない＝デフォルト全拒否。
--   ※ Supabase の既定 GRANT で anon/authenticated に ALL が付くため明示的に剥がす
--     （project_supabase_default_privileges_trap の教訓）。
-- ------------------------------------------------------------
alter table public.line_message_logs enable row level security;

revoke all on public.line_message_logs from anon, authenticated;
