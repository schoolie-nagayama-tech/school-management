-- ============================================================
-- ローカル検証用シードデータ
-- ============================================================
-- `npm run db:reset` / `supabase start` 実行後に自動投入される（config.toml の [db.seed]）。
-- 本番データは一切含まない。画面を触って確認するための最小セット。
--
-- 投入されるもの:
--   - 教室1（テスト校）
--   - スタッフ1（admin / staff@test.local / password123）
--   - 生徒2（在籍1・退塾済み1 ＝ ポータルの失効挙動を目視できる）
--   - ポータルアカウント1（保護者。parent / password123）→ 在籍生徒に紐づけ
--   - 保護者ポータルv2 の全体スイッチ ON
--
-- ★ ポータルのログイン確認手順:
--     npm run dev → http://localhost:3000/mypage/login
--     ログインID: parent / パスワード: password123
-- ============================================================

-- ------------------------------------------------------------
-- 教室
-- ------------------------------------------------------------
insert into public.schools (id, name)
values ('11111111-1111-1111-1111-111111111111', 'テスト校')
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- スタッフ（Supabase Auth ＋ user_profiles）
--   auth.users に直接入れる。パスワードは bcrypt ハッシュ（password123）。
--
-- ★ confirmation_token / recovery_token / email_change / email_change_token_new に
--   '' を入れている理由（2026-07-15・実機のGoTrueログで確定した罠）:
--     これらの列は NOT NULL ではないが、GoTrue(Go) は string として読むため NULL だと
--       Scan error on column "confirmation_token": converting NULL to string is unsupported
--     で POST /auth/v1/token が 500（"Database error querying schema"）になる。
--   ＝ これらを省くと **staff@test.local は作られた時から一度もログインできない**。
--   ローカルでスタッフ側の画面を検証できていなかったのはこれが原因。列を消さないこと。
-- ------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  raw_app_meta_data, raw_user_meta_data
)
values (
  '00000000-0000-0000-0000-000000000000',
  '22222222-2222-2222-2222-222222222222',
  'authenticated', 'authenticated', 'staff@test.local',
  crypt('password123', gen_salt('bf')),
  now(), now(), now(),
  -- ★ NULL 禁止（上記）。空文字を明示する。
  '', '', '', '',
  '{"provider":"email","providers":["email"]}', '{}'
)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
values (
  gen_random_uuid(), '22222222-2222-2222-2222-222222222222',
  '22222222-2222-2222-2222-222222222222',
  '{"sub":"22222222-2222-2222-2222-222222222222","email":"staff@test.local"}',
  'email', now(), now()
)
on conflict do nothing;

insert into public.user_profiles (id, email, display_name, role, is_active)
values ('22222222-2222-2222-2222-222222222222', 'staff@test.local', 'テスト管理者', 'admin', true)
on conflict (id) do nothing;

insert into public.user_schools (user_id, school_id)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
on conflict do nothing;

-- ------------------------------------------------------------
-- 生徒（在籍1・退塾済み1）
--   退塾済みの方はポータルから見えないのが正しい挙動（RLS の失効条件）。
-- ------------------------------------------------------------
insert into public.students (
  id, school_id, student_code, last_name, first_name, last_name_kana, first_name_kana,
  grade, status, withdrawal_date
)
values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'TEST001', '山田', '花子', 'ヤマダ', 'ハナコ', 8, 'active', null),
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'TEST002', '退塾', '太郎', 'タイジュク', 'タロウ', 9, 'withdrawn', current_date - 1)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- ポータルアカウント（保護者）
--   password_hash は bcrypt（password123）。src/lib/mypage/password.ts と同じ方式。
-- ------------------------------------------------------------
insert into public.portal_accounts (id, login_id, password_hash, display_name)
values (
  '55555555-5555-5555-5555-555555555555',
  'parent',
  crypt('password123', gen_salt('bf')),
  'テスト保護者'
)
on conflict (id) do nothing;

-- 在籍生徒にだけ紐づける（＋退塾生にも紐づけ、見えないことを確認できるようにする）
insert into public.portal_account_students (account_id, student_id, relation)
values
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 'mother'),
  ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', 'mother')
on conflict do nothing;

-- ------------------------------------------------------------
-- 保護者ポータルv2 の全体スイッチを ON（ローカルでのみ）
--   本番の既定は false（クローズド）。ローカルは画面確認のため有効化する。
-- ------------------------------------------------------------
insert into public.system_settings (key, value, description, category)
values ('portal_v2_enabled', 'true', 'ローカル検証用に有効化', 'portal')
on conflict (key) do update set value = 'true';
