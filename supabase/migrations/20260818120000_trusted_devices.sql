-- ============================================================
-- 教室端末マーク（講師の「家モード」の錨）
--
-- 背景（正典: docs/teacher-home-mode-plan.md §2）:
--   講師には「家から自分のシフト・出勤簿を見る」ことを許しつつ、「家から生徒情報を
--   開く」日常を作らせたくない。教室に固定IPの錨が無いため IP 制限は採れない。
--   代わりに教室の共有PC（ブラウザプロファイル）へ長期クッキーを1度だけ発行し、
--   その端末を「教室端末」と見なす。
--
--   判定式: role=teacher かつ 信頼済み端末でない → 家モード（教室限定ページをブロック）。
--   マークは端末に紐づくので、ログインする人が変わっても有効（共有PC前提）。
--
-- ★ これはソフト境界である（§0）:
--   クッキー複製や PostgREST 直叩きは防げない。目的は日常の構造化・事故低減・規程の土台。
--   既存の RLS（教室スコープ等）は一切変更しない。
--
-- 権限: service role 専用。
--   トークンの hash は「その端末が教室端末である」ことの証明そのものなので、
--   anon にも authenticated（＝ログイン済み講師）にも一切読ませない。判定は
--   /api/device-trust/* だけが service role で行い、結果の boolean のみ返す。
-- ============================================================

create table if not exists public.trusted_devices (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id),
  label        text not null,
  token_hash   text not null unique,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);

comment on table public.trusted_devices is
  '教室端末マーク。講師の家モード判定に使う信頼済み端末（ブラウザプロファイル）の台帳。service role 専用。';
comment on column public.trusted_devices.school_id is
  'この端末を設置している教室。一覧・失効の権限スコープ（発行者の所属教室）に使う。';
comment on column public.trusted_devices.label is
  '室長が付ける識別名（例: 「長山 受付PC」）。紛失時にどれを失効するか判断するための人間向けラベル。';
comment on column public.trusted_devices.token_hash is
  'ブラウザに渡した長期クッキーのトークンの sha256。★平文トークンは保存しない（DB流出だけでは端末を騙れないようにする）。';
comment on column public.trusted_devices.created_by is
  '発行した室長/管理者の auth.users.id。誰が設置したかの追跡用。ユーザー削除時に備え NULL 許容。';
comment on column public.trusted_devices.last_seen_at is
  '最後にこの端末から信頼済みと判定された時刻。1日1回程度に間引いて更新する（毎リクエストの書き込みを避けるため）。使われていない端末の棚卸しに使う。';
comment on column public.trusted_devices.revoked_at is
  '失効時刻。NULL のみ信頼済みとして扱う。端末紛失・退去時に室長がセットする（行は消さず履歴として残す）。';

-- 教室ごとの一覧（/settings/trusted-devices）で使う
create index if not exists idx_trusted_devices_school
  on public.trusted_devices (school_id, created_at desc);

-- ------------------------------------------------------------
-- 権限: RLS を有効にしつつポリシーを1つも作らない＝デフォルト全拒否。
--   ※ Supabase の既定 GRANT で anon/authenticated に ALL が付くため明示的に剥がす
--     （落とし穴_Supabase既定権限でanon・authenticatedにALLが付く の教訓。
--       RLS だけでは「止まっている」つもりで止まっていない）。
-- ------------------------------------------------------------
alter table public.trusted_devices enable row level security;

revoke all on public.trusted_devices from anon, authenticated;
