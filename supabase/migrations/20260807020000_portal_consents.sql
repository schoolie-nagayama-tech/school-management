-- ============================================================
-- 保護者ポータルの同意ログ（誰が・いつ・どの版に同意したか）
--
-- 背景（docs/release-roadmap-2026H2.md P3-L4）:
--   保護者・生徒の個人情報を扱う以上、プライバシーポリシーと利用規約への同意を
--   取得した事実を後から立証できる必要がある。招待受諾時（初回）と、文書の版が
--   上がったときの再同意時に、ここへ1行ずつ残す。
--
-- ★ IPアドレス・User-Agent は保存しない:
--   portal_accounts は氏名・連絡先を持たない設計（表示名と続柄のみ）で、PIIの
--   保有量を意図的に絞っている。同意の立証に必要なのは「どのアカウントが」
--   「どの文書の」「どの版に」「いつ」同意したかであって、端末や回線の識別では
--   ない。IP/UA を足すと立証力はほとんど変わらないまま、プライバシーポリシー
--   第2条の取得項目と保存期間の管理対象だけが増える。よって保存しない。
--
-- 版（version）の扱い:
--   src/lib/mypage/legal.ts の LEGAL_DOCUMENTS が現在版の正典。版を上げると
--   最新版の行が無いアカウントは /mypage/consent へ誘導され、再同意を求められる。
--   過去の同意行は消さずに積む（履歴＝同意の証跡そのもの）。
-- ============================================================

create table if not exists public.portal_consents (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.portal_accounts(id) on delete cascade,
  document   text not null check (document in ('privacy_policy', 'terms_of_service')),
  version    text not null,                                  -- 例: 'v1.0'（legal.ts と一致させる）
  agreed_at  timestamptz not null default now()
);

comment on table public.portal_consents is '保護者ポータルの同意ログ（誰がいつどの版に同意したか）。IP/UAは意図的に保存しない。';
comment on column public.portal_consents.version is '同意した文書の版。src/lib/mypage/legal.ts の LEGAL_DOCUMENTS が正典。';

-- 「このアカウントはこの文書の最新版に同意済みか」を引くための索引
-- （hasCurrentConsent が account_id + document で最新行を見る）。
create index if not exists idx_portal_consents_account_document
  on public.portal_consents (account_id, document, agreed_at desc);

-- ------------------------------------------------------------
-- 権限: service role 専用（アプリの同意記録処理だけが書く）
--   保護者（portal ロール）にもスタッフ（authenticated）にも触らせない。
--   同意ログは改ざんされたら証跡としての意味を失うため、本人にも更新させない。
--   RLS を有効にしつつポリシーを1つも作らない＝デフォルト全拒否。
--   ※ Supabase の既定 GRANT で anon/authenticated に ALL が付くため明示的に剥がす
--     （project_supabase_default_privileges_trap の教訓）。
-- ------------------------------------------------------------
alter table public.portal_consents enable row level security;

revoke all on public.portal_consents from anon, authenticated;
