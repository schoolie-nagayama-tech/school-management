-- ============================================================
-- 保護者ポータル v2 土台（Stage 1）
-- 正典: docs/portal-v2-requirements.md §6 / docs/account-line-design.md §3・§4
-- ============================================================
-- 目的:
--   保護者・生徒本人向けの「ポータルアカウント」レイヤーを既存の students の
--   外側に薄く足す。認証は案3（自前ログイン→自前署名のSupabase互換JWT→RLSで
--   認可）。生徒テーブル(students)のスキーマは無変更で、SELECTポリシー
--   を「併存追加」するだけ（既存スタッフ用ポリシーは触らない）。
--
-- 不変条件（docs/portal-v2-requirements.md §6-3）:
--   - 追加するのは portal_* の新テーブルのみ。
--   - 既存テーブルへはポリシー追加のみ（既存ポリシー・列は変更しない）。
--
-- 適用状況: 2026-07-16 に本番へ適用済み（MCP の apply_migration・版名 portal_v2_foundation）。
--       ※ 以前ここには「本番には適用しない」と書いてあったが、それは Stage1 開発時点の
--         記述。本番デモ（docs/portal-v2-demo-handoff.md §3-2）で適用したため改めた。
--       portal ロールと portal_uid() は本番PoCで作成済みのため冪等に書く。
-- ============================================================

-- ------------------------------------------------------------
-- ポータル専用 Postgres ロール `portal`
--
-- ★ なぜ authenticated ロールを使わないのか（構造的隔離の設計意図）:
--   既存RLSポリシー群には「authenticated＝スタッフ」を暗黙に仮定した広いポリシー
--   がある（例: subjects / curriculum_items / textbooks は authenticated に
--   ALL using(true) = 書き込み含む全許可、system_settings 等も SELECT using(true)）。
--   ポータルJWTを role:'authenticated' で発行すると、保護者・生徒にこれらが
--   丸ごと適用されてしまう（本番で実測確認済み）。
--
--   そこでポータルJWTは専用ロール `portal` で発行し、既存の `to authenticated`
--   ポリシー群から構造的に隔離する。portal にはデフォルト全拒否＋明示グラント
--   のみが効くため、将来テーブルが増えても自動的に安全側に倒れる。
--   → ポータルに見せたいテーブルは今後も必ず
--        grant <権限> on <テーブル> to portal  ＋  create policy ... to portal
--     の2点セットを明示的に書くこと（このデフォルト拒否が意図した挙動）。
-- ------------------------------------------------------------
do $$
begin
  if not exists (select from pg_roles where rolname = 'portal') then
    -- nologin: 直接接続不可（PostgREST の成り代わり専用）
    -- noinherit: 他ロールの権限を継承しない（明示グラントのみ有効）
    create role portal nologin noinherit;
  end if;
end
$$;

-- PostgREST(authenticator) が JWT の role クレームに従って portal に成り代われるようにする。
grant portal to authenticator;
-- スキーマ usage が無いとテーブル権限以前に一切アクセスできないため付与する。
grant usage on schema public to portal;

-- ------------------------------------------------------------
-- public.portal_uid(): ポータルJWTの sub（= portal_account_id）を返す
--
-- ★ auth.uid() が使えない理由:
--   auth スキーマの所有者は Supabase 内部ロールであり、postgres からの
--   `grant usage on schema auth to portal` は警告付きで無視される（付与不能）。
--   そのため portal ロールのポリシーからは auth.uid() を呼べない。
--   代わりに public スキーマの自前関数で request.jwt.claims から sub を読む
--   （auth.uid() と同等のロジック）。
-- ------------------------------------------------------------
create or replace function public.portal_uid() returns uuid
  language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$$;

comment on function public.portal_uid() is
  'ポータルJWTの sub（portal_account_id）を返す。portal ロールは auth スキーマに usage を持てず auth.uid() が使えないための代替。';

grant execute on function public.portal_uid() to portal;

-- ------------------------------------------------------------
-- portal_accounts: 保護者・生徒本人を統合した認証アカウント（PIIは持たない）
--   - line_user_id: LINE連携した人だけ（Stage1では未使用だが将来のため定義）
--   - login_id / password_hash: 教室発行のID/PWフォールバック（Stage1の主役）
--   - どちらも nullable。「LINE のみ」「ID/PW のみ」「両方」を許容する。
-- ------------------------------------------------------------
create table if not exists public.portal_accounts (
  id            uuid primary key default gen_random_uuid(),
  line_user_id  text unique,               -- LINE連携ユーザーID（Stage1では未使用）
  login_id      text unique,               -- 教室発行ログインID（フォールバック）
  password_hash text,                      -- bcrypt ハッシュ（平文は保存しない）
  display_name  text not null,             -- 表示名（LINEプロフィール名 or 教室入力）
  avatar_url    text,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.portal_accounts is '保護者・生徒本人のポータルアカウント（PIIなし・案3認証の主体）。';
comment on column public.portal_accounts.password_hash is 'bcrypt ハッシュ。平文パスワードは保存しない。';

-- ------------------------------------------------------------
-- portal_account_students: アカウントと生徒の多対多紐づけ
--   - 生徒本人は relation='self' で自分の生徒IDに1本
--   - 保護者は子ごと（兄弟は複数行）に father/mother/other で紐づく
--   - relation は invite_type とセットで閲覧権限を確定する（自己昇格の防止）
-- ------------------------------------------------------------
create table if not exists public.portal_account_students (
  account_id uuid not null references public.portal_accounts(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  relation   text not null check (relation in ('self', 'father', 'mother', 'other')),
  created_at timestamptz not null default now(),
  primary key (account_id, student_id)
);

comment on table public.portal_account_students is 'ポータルアカウントと生徒の紐づけ（relation で本人/保護者区分）。';

-- 生徒側からの逆引き（この生徒に紐づくアカウント一覧）を高速化する。
create index if not exists idx_portal_account_students_student
  on public.portal_account_students (student_id);

-- ------------------------------------------------------------
-- portal_invitations: 教室が発行しアカウント紐づけに使う招待トークン
--   - invite_type を発行時に固定 → 生徒が「保護者」を自称して権限昇格するのを防ぐ
--   - accepted_by は受諾で消えても招待記録は残せるよう ON DELETE SET NULL
--   - school_id は発行教室の記録（アドミンの一覧絞り込み用）
-- ------------------------------------------------------------
create table if not exists public.portal_invitations (
  id          uuid primary key default gen_random_uuid(),
  token       text unique not null,        -- 受諾URLに載せる十分な強度のランダム文字列
  student_id  uuid not null references public.students(id) on delete cascade,
  invite_type text not null check (invite_type in ('guardian', 'student')),
  expires_at  timestamptz not null,        -- 発行から7日（account-line-design.md §9）
  accepted_at timestamptz,                 -- 受諾済みなら受諾時刻。未受諾は NULL
  accepted_by uuid references public.portal_accounts(id) on delete set null,
  created_by  uuid references public.user_profiles(id),  -- 発行スタッフ
  school_id   uuid references public.schools(id),        -- 発行教室（一覧絞り込み用）
  created_at  timestamptz not null default now()
);

comment on table public.portal_invitations is '教室発行のポータル招待トークン（invite_type で権限確定、7日失効）。';

-- アドミンの一覧絞り込み（教室別・生徒別）を高速化する。
create index if not exists idx_portal_invitations_school on public.portal_invitations (school_id);
create index if not exists idx_portal_invitations_student on public.portal_invitations (student_id);

-- ------------------------------------------------------------
-- 権限（GRANT）
--   RLS で細かく絞るが、テーブルレベルの権限が無いと RLS 以前に 403 になるため
--   portal ロールに必要最小限の SELECT を明示付与する。
--   - portal: 本人スコープの SELECT のみ（RLS が更に絞る）。
--     authenticated（スタッフ）には付与しない = スタッフからポータルアカウントは
--     service role API 経由でのみ扱う。anon には一切与えない。
--   - service_role: 全操作（ログイン・招待発行/受諾など書き込みは service role 経由）。
-- ------------------------------------------------------------
grant select on public.portal_accounts to portal;
grant select on public.portal_account_students to portal;
-- ポータルに見せる既存テーブル。テーブルレベル権限が無いと RLS 以前に 403 になる。
grant select on public.students to portal;
grant all on public.portal_accounts to service_role;
grant all on public.portal_account_students to service_role;
grant all on public.portal_invitations to service_role;

-- ------------------------------------------------------------
-- RLS 有効化
-- ------------------------------------------------------------
alter table public.portal_accounts enable row level security;
alter table public.portal_account_students enable row level security;
alter table public.portal_invitations enable row level security;

-- portal_accounts: 本人（id = portal_uid()）だけが自分の行を SELECT できる。
-- INSERT/UPDATE/DELETE のポリシーは作らない = service role 専用（ログインAPI等）。
create policy "portal_accounts_select_self" on public.portal_accounts
  for select to portal
  using (id = public.portal_uid());

-- portal_account_students: 自分のアカウントに紐づく行だけ SELECT できる。
-- 紐づけの作成/削除は service role 専用（招待受諾API等）。
create policy "portal_account_students_select_self" on public.portal_account_students
  for select to portal
  using (account_id = public.portal_uid());

-- portal_invitations: ポリシーを一切作らない = 全操作 service role 専用。
-- （招待の存在自体がクローズドの担保なので、portal / authenticated にも見せない。）

-- ------------------------------------------------------------
-- students へのポータル用 SELECT ポリシー（併存追加）
--   既存 students_school_scope_auth（スタッフ用・to authenticated）はそのまま。
--   これは portal ロール専用の追加ポリシーで、ポータルアカウント
--   （portal_uid()=portal_account_id）に「自分が紐づく生徒」だけを見せる。
--   ロールが違うため両ポリシーは互いに干渉しない:
--     - スタッフJWT(authenticated) → 既存 check_student_access のみ評価
--     - ポータルJWT(portal)        → このポリシーのみ評価（紐づけ生徒に限定）
--
--   ★ 失効の仕組み: 述語末尾の
--        (withdrawal_date is null or withdrawal_date >= current_date)
--     が「退塾日を過ぎた生徒は自動的に見えなくなる」実体。退塾で紐づけ行を
--     消さなくても、この日付比較だけで RLS が翌閲覧から遮断する（猶予なし）。
--     兄弟が在籍中なら保護者アカウント自体は有効で、当該生徒の閲覧だけが切れる。
-- ------------------------------------------------------------
create policy "portal_students_select_linked" on public.students
  for select to portal
  using (
    exists (
      select 1
      from public.portal_account_students pas
      where pas.account_id = public.portal_uid()
        and pas.student_id = students.id
    )
    and (students.withdrawal_date is null or students.withdrawal_date >= current_date)
  );

-- ------------------------------------------------------------
-- 全体スイッチ（クローズド制御・緊急遮断用）
--   system_settings に portal_v2_enabled を false で seed する。
--   /mypage レイアウトがこの値を読み、false なら 404 にする。
--   既に行があれば何もしない（再適用しても既存値を壊さない）。
-- ------------------------------------------------------------
insert into public.system_settings (key, value, description, category)
values (
  'portal_v2_enabled',
  'false',
  '保護者ポータルv2 の全体有効スイッチ。false のとき /mypage 全体を 404 にする（クローズド期間の緊急遮断用）。',
  'portal'
)
on conflict (key) do nothing;
