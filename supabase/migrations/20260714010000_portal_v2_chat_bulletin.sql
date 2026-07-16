-- ============================================================
-- 保護者ポータル v2 コミュニケーション（Stage 2）
-- 正典: docs/portal-v2-requirements.md §7-2 / docs/account-line-design.md §9・§6
-- ============================================================
-- 目的:
--   ④ 1対1チャット（生徒ごと1スレッド・相手=教室）と、⑤ 掲示板 audience 拡張を
--   既存構造の外側に足す。チャットは新規4テーブル。掲示板は「唯一許された既存テーブル
--   変更」として列追加（既定値で既存動作を完全不変に保つ）＋別テーブル併設。
--
-- 不変条件（docs/portal-v2-requirements.md §6-3 / §7-2）:
--   - チャットは新規 chat_* テーブルのみ。
--   - 既存 bulletin_posts へは「既定値付き列追加」のみ（既定 {社内}/all で従来動作不変）。
--     既存の bulletin_posts スタッフ用ポリシー・grant は一切触らない（portal 用の
--     SELECT ポリシーを併存追加するだけ）。
--   - ポータル既読は既存 bulletin_reads（スタッフ前提でガチガチ）を汚さず別テーブル。
--
-- ポータル可視化の鉄則（Stage1 で確立・厳守）:
--   ポータルに見せるテーブルは必ず「grant select ... to portal」＋「to portal の RLS
--   ポリシー」の2点セット。ポリシー内は auth.uid() でなく public.portal_uid() を使う。
--   書き込み（投稿・システムメッセージ・既読）は service role 経由の API で行う
--   （このマイグレーションでは portal に INSERT/UPDATE/DELETE を一切与えない）。
--
-- 適用状況: 2026-07-16 に本番へ適用済み（MCP の apply_migration・版名 portal_v2_chat_bulletin）。
--       ※ 以前の「本番には適用しない」は Stage2 開発時点の記述。本番デモ
--         （docs/portal-v2-demo-handoff.md §3-2）で適用したため改めた。
--       portal ロール／portal_uid() は Stage1(20260714000000) で作成済みの前提。冪等に書く。
-- ============================================================

-- ============================================================
-- 1) チャット（生徒ごと1スレッド・相手=教室の室長）
-- ============================================================

-- ------------------------------------------------------------
-- chat_threads: 生徒ごとに1本のスレッド。
--   - student_id を unique にして「生徒ごと1スレッド」を DB 制約で担保する
--     （多スレッド分裂を構造的に禁止。混乱回避は話題フィルタ＋構造化カードで行う）。
--   - created_by は開始スタッフ（保護者初回発信で自動作成のときは NULL）。
-- ------------------------------------------------------------
create table if not exists public.chat_threads (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null unique references public.students(id) on delete cascade,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now()
);

comment on table public.chat_threads is '保護者⇔教室の1対1チャットスレッド（生徒ごと1本・student_id unique）。';

-- ------------------------------------------------------------
-- chat_thread_participants: スレッドに参加するポータルアカウント。
--   保護者/生徒本人（複数可: 父母＋本人）。室長が指定 or 相手発信で自動追加。
-- ------------------------------------------------------------
create table if not exists public.chat_thread_participants (
  thread_id          uuid not null references public.chat_threads(id) on delete cascade,
  portal_account_id  uuid not null references public.portal_accounts(id) on delete cascade,
  created_at         timestamptz not null default now(),
  primary key (thread_id, portal_account_id)
);

comment on table public.chat_thread_participants is 'チャットスレッドの参加ポータルアカウント（保護者/生徒本人）。';

-- 逆引き（このアカウントが参加するスレッド一覧）を高速化する。
create index if not exists idx_chat_thread_participants_account
  on public.chat_thread_participants (portal_account_id);

-- ------------------------------------------------------------
-- chat_messages: 1メッセージ。
--   - sender_kind: 'staff'(室長) / 'portal'(保護者・生徒) / 'system'(自動生成)
--   - sender_id: staff=user_profiles.id / portal=portal_accounts.id / system=NULL
--   - template_kind: 'absence'|'transfer_request'|'meeting_request'（構造化メッセージ）
--   - payload: テンプレの構造化データ（日付・時限・理由・振替希望候補 candidates 等）
-- ------------------------------------------------------------
create table if not exists public.chat_messages (
  id            uuid primary key default gen_random_uuid(),
  thread_id     uuid not null references public.chat_threads(id) on delete cascade,
  sender_kind   text not null check (sender_kind in ('staff', 'portal', 'system')),
  sender_id     uuid,                       -- staff:user_profiles.id / portal:portal_accounts.id / system:NULL
  body          text not null,
  template_kind text check (template_kind in ('absence', 'transfer_request', 'meeting_request')),
  payload       jsonb,
  created_at    timestamptz not null default now()
);

comment on table public.chat_messages is 'チャットメッセージ（staff/portal/system）。template_kind+payload で構造化メッセージを表す。';
comment on column public.chat_messages.sender_kind is 'staff=室長 / portal=保護者・生徒 / system=自動生成（受付返信・振替確定通知）。';
comment on column public.chat_messages.payload is 'テンプレの構造化データ。振替希望は candidates:[{date,slot}...] を持つ。';

-- スレッドの時系列取得を高速化する。
create index if not exists idx_chat_messages_thread_created
  on public.chat_messages (thread_id, created_at);

-- ------------------------------------------------------------
-- chat_reads: 既読ポインタ（reader ごとに last_read_at を1行）。
--   reader_kind: 'staff' | 'portal'。reader_id は staff=user_profiles.id / portal=portal_accounts.id。
--   これ以降に created_at を持つメッセージが「未読」。
-- ------------------------------------------------------------
create table if not exists public.chat_reads (
  thread_id    uuid not null references public.chat_threads(id) on delete cascade,
  reader_kind  text not null check (reader_kind in ('staff', 'portal')),
  reader_id    uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, reader_kind, reader_id)
);

comment on table public.chat_reads is 'チャット既読ポインタ（reader_kind+reader_id ごとの last_read_at）。';

-- ------------------------------------------------------------
-- チャットの権限（GRANT）
--   portal: 自分が participant のスレッド／メッセージ／既読の SELECT のみ（RLS が更に絞る）。
--   service_role: 全操作（投稿・システムメッセージ・既読は service role 経由の API）。
--   authenticated（スタッフ）には付与しない = スタッフも service role API 経由で扱う
--     （chat_* は portal 以外に SELECT ポリシーを作らない = 既定全拒否）。
-- ------------------------------------------------------------
grant select on public.chat_threads to portal;
grant select on public.chat_thread_participants to portal;
grant select on public.chat_messages to portal;
grant select on public.chat_reads to portal;

grant all on public.chat_threads to service_role;
grant all on public.chat_thread_participants to service_role;
grant all on public.chat_messages to service_role;
grant all on public.chat_reads to service_role;

-- ------------------------------------------------------------
-- チャットの RLS
-- ------------------------------------------------------------
alter table public.chat_threads enable row level security;
alter table public.chat_thread_participants enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads enable row level security;

-- chat_thread_participants: 自分（portal_uid()）の参加行だけ SELECT できる。
-- これが他ポリシーの「自分が参加するスレッド」判定の基点になる。
drop policy if exists "chat_participants_select_self" on public.chat_thread_participants;
create policy "chat_participants_select_self" on public.chat_thread_participants
  for select to portal
  using (portal_account_id = public.portal_uid());

-- chat_threads: 自分が participant のスレッドだけ SELECT できる。
drop policy if exists "chat_threads_select_participant" on public.chat_threads;
create policy "chat_threads_select_participant" on public.chat_threads
  for select to portal
  using (
    exists (
      select 1
      from public.chat_thread_participants p
      where p.thread_id = chat_threads.id
        and p.portal_account_id = public.portal_uid()
    )
  );

-- chat_messages: 自分が participant のスレッドのメッセージだけ SELECT できる。
drop policy if exists "chat_messages_select_participant" on public.chat_messages;
create policy "chat_messages_select_participant" on public.chat_messages
  for select to portal
  using (
    exists (
      select 1
      from public.chat_thread_participants p
      where p.thread_id = chat_messages.thread_id
        and p.portal_account_id = public.portal_uid()
    )
  );

-- chat_reads: 自分が participant のスレッドの既読行だけ SELECT できる。
-- （相手=室長(staff)の last_read_at も見えるが、これは「既読済み」表示のためで害はない。
--   他人のスレッドの既読は participant 判定で弾かれる。）
drop policy if exists "chat_reads_select_participant" on public.chat_reads;
create policy "chat_reads_select_participant" on public.chat_reads
  for select to portal
  using (
    exists (
      select 1
      from public.chat_thread_participants p
      where p.thread_id = chat_reads.thread_id
        and p.portal_account_id = public.portal_uid()
    )
  );


-- ============================================================
-- 2) 掲示板 audience 拡張（唯一の既存テーブル変更・既定値で従来動作不変）
-- ============================================================

-- ------------------------------------------------------------
-- bulletin_posts への列追加。
--   - audience: 配信先の集合。既定 {社内} = 従来どおり「スタッフだけが読む社内連絡」。
--     保護者/生徒に出すには明示的に '保護者'/'生徒' を含める（既定では絶対に漏れない）。
--   - target_scope: 'all'（全体）/ 'grade'（学年指定）/ 'individual'（個別生徒）。既定 all。
--   - target_grade: target_scope='grade' のときの対象学年（students.grade と一致比較）。
--   ★ 既定 {社内}/all で既存投稿・既存 INSERT（列を指定しない）とも完全に従来挙動になる。
-- ------------------------------------------------------------
alter table public.bulletin_posts
  add column if not exists audience text[] not null default '{社内}';
alter table public.bulletin_posts
  add column if not exists target_scope text not null default 'all';
alter table public.bulletin_posts
  add column if not exists target_grade int[];

-- target_scope の値域チェック（既存行はすべて既定 'all' なので違反しない）。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bulletin_posts_target_scope_check'
  ) then
    alter table public.bulletin_posts
      add constraint bulletin_posts_target_scope_check
      check (target_scope in ('all', 'grade', 'individual'));
  end if;
end
$$;

comment on column public.bulletin_posts.audience is '配信先集合。既定 {社内}=社内連絡（従来動作）。保護者/生徒に出すには明示指定。';
comment on column public.bulletin_posts.target_scope is 'all=全体 / grade=学年指定(target_grade) / individual=個別(bulletin_post_targets)。';

-- ------------------------------------------------------------
-- bulletin_post_targets: 個別配信（target_scope='individual'）の対象生徒。
-- ------------------------------------------------------------
create table if not exists public.bulletin_post_targets (
  post_id    uuid not null references public.bulletin_posts(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  primary key (post_id, student_id)
);

comment on table public.bulletin_post_targets is '掲示板の個別配信対象生徒（target_scope=individual のときに使う）。';

create index if not exists idx_bulletin_post_targets_student
  on public.bulletin_post_targets (student_id);

-- ------------------------------------------------------------
-- bulletin_portal_reads: ポータル側の既読（スタッフ前提の bulletin_reads を汚さない別テーブル）。
-- ------------------------------------------------------------
create table if not exists public.bulletin_portal_reads (
  post_id           uuid not null references public.bulletin_posts(id) on delete cascade,
  portal_account_id uuid not null references public.portal_accounts(id) on delete cascade,
  read_at           timestamptz not null default now(),
  primary key (post_id, portal_account_id)
);

comment on table public.bulletin_portal_reads is 'ポータル利用者の掲示板既読。既存 bulletin_reads（スタッフ用）とは別管理。';

-- ------------------------------------------------------------
-- 掲示板の権限（GRANT）
--   portal: bulletin_posts / bulletin_post_targets / bulletin_portal_reads の SELECT のみ。
--   service_role: bulletin_post_targets / bulletin_portal_reads は書き込みも（投稿作成・既読記録）。
--   ★ 既存 bulletin_posts の grant/policy は触らない（併存追加のみ）。
-- ------------------------------------------------------------
grant select on public.bulletin_posts to portal;
grant select on public.bulletin_post_targets to portal;
grant select on public.bulletin_portal_reads to portal;

grant all on public.bulletin_post_targets to service_role;
grant all on public.bulletin_portal_reads to service_role;

-- ------------------------------------------------------------
-- 掲示板のポータル用 RLS（併存追加）
-- ------------------------------------------------------------
alter table public.bulletin_post_targets enable row level security;
alter table public.bulletin_portal_reads enable row level security;
-- bulletin_posts は既に RLS 有効（既存）。有効化は冪等なので明示しておく。
alter table public.bulletin_posts enable row level security;

-- bulletin_post_targets: portal は「自分の紐づけ生徒が対象の行」だけ SELECT できる。
-- （下の bulletin_posts ポリシーの individual 判定がこの可視性に乗る。）
drop policy if exists "bulletin_post_targets_select_portal" on public.bulletin_post_targets;
create policy "bulletin_post_targets_select_portal" on public.bulletin_post_targets
  for select to portal
  using (
    exists (
      select 1
      from public.portal_account_students pas
      where pas.account_id = public.portal_uid()
        and pas.student_id = bulletin_post_targets.student_id
    )
  );

-- bulletin_portal_reads: portal は自分の既読だけ SELECT できる。書き込みは service role。
drop policy if exists "bulletin_portal_reads_select_self" on public.bulletin_portal_reads;
create policy "bulletin_portal_reads_select_self" on public.bulletin_portal_reads
  for select to portal
  using (portal_account_id = public.portal_uid());

-- bulletin_posts: portal 用の SELECT ポリシー（既存スタッフ/anon ポリシーとは別・to portal）。
--   可視条件（すべて「自分の紐づけ生徒1人」を文脈に判定する = その生徒が
--   投稿の教室に在籍し、relation に応じた audience が立っていて、target に該当する）:
--     (1) 教室スコープ: 投稿の school_id = 紐づけ生徒の所属校（他教室の投稿は見せない）
--     (2) audience と relation の対応: 生徒本人(relation='self')は '生徒' 宛のみ、
--         保護者(father/mother/other)は '保護者' 宛のみ可視（「生徒に保護者向け情報を
--         出さない」の確定方針。社内のみの投稿は誰にも出さない）
--     (3) target_scope: all=教室全体 / grade=その生徒の学年が target_grade に含まれる /
--         individual=bulletin_post_targets にその生徒が居る
--     (4) 公開状態: アーカイブ済み・公開期間外（予約公開前/公開終了後）は見せない
--         （スタッフ画面はアプリ層で絞っているが、ポータルは直接PostgRESTを叩かれても
--          漏れないようDB層で担保する）
--   ※ students への join には students の portal RLS（紐づけ＋在籍中）が効くので、
--      退塾失効も自動的に反映される。
drop policy if exists "bulletin_posts_select_portal" on public.bulletin_posts;
create policy "bulletin_posts_select_portal" on public.bulletin_posts
  for select to portal
  using (
    is_archived = false
    and (publish_start_at is null or publish_start_at <= now())
    and (publish_end_at is null or publish_end_at >= now())
    and exists (
      select 1
      from public.portal_account_students pas
      join public.students s on s.id = pas.student_id
      where pas.account_id = public.portal_uid()
        -- (1) 教室スコープ
        and s.school_id = bulletin_posts.school_id
        -- (2) relation に応じた audience
        and (
          (pas.relation = 'self' and '生徒' = any (bulletin_posts.audience))
          or (pas.relation <> 'self' and '保護者' = any (bulletin_posts.audience))
        )
        -- (3) 配信範囲（同じ生徒を文脈に判定する）
        and (
          bulletin_posts.target_scope = 'all'
          or (
            bulletin_posts.target_scope = 'grade'
            and s.grade = any (bulletin_posts.target_grade)
          )
          or (
            bulletin_posts.target_scope = 'individual'
            and exists (
              select 1 from public.bulletin_post_targets t
              where t.post_id = bulletin_posts.id
                and t.student_id = s.id
            )
          )
        )
    )
  );
