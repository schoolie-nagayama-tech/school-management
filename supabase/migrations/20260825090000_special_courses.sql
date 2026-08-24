-- ============================================================
-- 特別講座の再設計（通年 ＋ 講習限定）— フェーズ1
--
-- 正典: docs/special-courses-plan.md（2026-08-24 確定）
--
-- 目指す構造:
--   指導形態（座席表のタブ）= 個別 / 小集団 / プログラミング の3つ
--   特別講座（学年×科目の開講単位。名前・単価・定員・名簿を持つ）
--     ├ 通年講座 (scope='year_round') … 時間割=曜日×コマ。講習期だけ時間を上書きできる
--     └ 講習講座 (scope='koushu')     … その講習期だけ。日付指定
--
-- 「クラス枠」は廃語。枠は必ずどれかの講座に属する
--   （schedule_regular_patterns.special_course_id）。
--
-- RLS/grant の方針は 20260805130000_koushu_special_courses.sql を踏襲:
--   教室スコープ = check_school_access(school_id) の for all to authenticated 1本、
--   anon は revoke、更新時刻は update_updated_at_column トリガー。
-- ============================================================

begin;

-- ── 1. 指導形態の整理（個別 / 小集団 / プログラミング の3つ） ──
-- 「集団」は座席表タブの表示名としては実態と合わないため「小集団」へ改名する。
-- キー 'group' は既存データ（schedule_entries / time_slots / 講習の集団申込）が
-- 大量に参照しているので不変。改名するのは label だけ。
update public.schedule_formations set label = '小集団' where key = 'group';

-- プログラミング形態を新規シード。HAL は「形態」ではなく「プログラミング形態の下の講座」になる。
insert into public.schedule_formations (key, label, lane_type, is_system, is_active, sort_order)
values ('f_programming', 'プログラミング', 'group', false, true, 30)
on conflict (key) do nothing;

-- 旧 HAL 形態を畳む（本番調査: patterns=0 / entries=0 / コマ時間1枠のみ＝安全）。
-- 物理削除しないのは FK(RESTRICT) とコマ時間の履歴を壊さないため。存在しない環境では 0 行更新。
update public.schedule_formations set is_active = false where key = 'f_zrshafsx';

-- ── 2. 特別講座（通年＋講習限定を1テーブル） ──
create table if not exists public.special_courses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  -- 'year_round'=通年講座 / 'koushu'=その講習期だけの講座
  scope text not null check (scope in ('year_round', 'koushu')),
  formation text not null references public.schedule_formations(key) on delete restrict,
  name text not null,
  -- 対象学年（1-13）。空配列=全学年
  target_grades integer[] not null default '{}',
  -- 講座は「学年×科目」の開講単位。科目未指定（総合・プログラミング等）は NULL
  subject_id uuid references public.subjects(id) on delete set null,
  -- 1回あたりの単価（円・税込）。請求連携（フェーズ2）で使う
  unit_price integer,
  capacity integer,
  -- 講習講座のみ必須。通年講座は NULL
  season text,
  year integer,
  -- 講習講座の開催予定 [{date,start_time,end_time}]（koushu_special_courses と同形式）
  session_dates jsonb not null default '[]',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint special_courses_koushu_period_check
    check (scope <> 'koushu' or (season is not null and year is not null))
);

comment on table public.special_courses is
  '特別講座（通年講座＋講習講座）。個別以外の形態で開く学年×科目の開講単位。正典 docs/special-courses-plan.md';

-- 一覧は「教室 × scope（× 講習期）」で引く。通年講座は season/year が NULL なので同じ索引で拾える。
create index if not exists idx_special_courses_school_scope
  on public.special_courses (school_id, scope, season, year, is_active);

alter table public.special_courses enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'special_courses'
       and policyname = 'special_courses_school_scope'
  ) then
    create policy special_courses_school_scope
      on public.special_courses for all to authenticated
      using (check_school_access(school_id))
      with check (check_school_access(school_id));
  end if;
end $$;

revoke all on public.special_courses from anon;

drop trigger if exists special_courses_set_updated_at on public.special_courses;
create trigger special_courses_set_updated_at
before update on public.special_courses
for each row execute function public.update_updated_at_column();

-- ── 3. 通年講座の講習期上書き ──
-- 行が無ければ「通常どおりの時間割で開催」。行があればその講習期だけ日時を差し替える。
create table if not exists public.special_course_koushu_overrides (
  course_id uuid not null references public.special_courses(id) on delete cascade,
  season text not null,
  year integer not null,
  session_dates jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (course_id, season, year)
);

comment on table public.special_course_koushu_overrides is
  '通年講座の講習期上書き。行が無ければ通常の時間割のまま開催する（docs/special-courses-plan.md §3）';

alter table public.special_course_koushu_overrides enable row level security;

-- 上書き行自体は school_id を持たないので、親講座の教室でスコープする。
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'special_course_koushu_overrides'
       and policyname = 'special_course_koushu_overrides_school_scope'
  ) then
    create policy special_course_koushu_overrides_school_scope
      on public.special_course_koushu_overrides for all to authenticated
      using (
        exists (
          select 1 from public.special_courses sc
           where sc.id = special_course_koushu_overrides.course_id
             and check_school_access(sc.school_id)
        )
      )
      with check (
        exists (
          select 1 from public.special_courses sc
           where sc.id = special_course_koushu_overrides.course_id
             and check_school_access(sc.school_id)
        )
      );
  end if;
end $$;

revoke all on public.special_course_koushu_overrides from anon;

drop trigger if exists special_course_koushu_overrides_set_updated_at
  on public.special_course_koushu_overrides;
create trigger special_course_koushu_overrides_set_updated_at
before update on public.special_course_koushu_overrides
for each row execute function public.update_updated_at_column();

-- ── 4. 枠→講座リンク（通年講座の時間割・名簿はこれで表現する） ──
-- ON DELETE SET NULL: 講座を消しても生徒の通塾日程は消さない（座席表が静かに欠けるのを防ぐ）。
alter table public.schedule_regular_patterns
  add column if not exists special_course_id uuid
  references public.special_courses(id) on delete set null;

comment on column public.schedule_regular_patterns.special_course_id is
  '所属する特別講座。個別形態の通塾日程は NULL。形態ボードの枠は必ず講座に属する';

-- 名簿取得（講座に紐づく枠の生徒一覧）で使う索引
create index if not exists idx_schedule_regular_patterns_special_course
  on public.schedule_regular_patterns (special_course_id)
  where special_course_id is not null;

-- ── 5. 移行: koushu_special_courses → special_courses(scope='koushu') ──
-- id をそのまま引き継ぐ（koushu_enrollments.course_id の参照先を無傷で張り替えるため）。
-- 冪等: 既に移行済みの id はスキップする。旧テーブルは削除しない（読み取り参照を
-- すべて新テーブルへ差し替えたのを確認してから後日 drop する）。
insert into public.special_courses (
  id, school_id, scope, formation, name, target_grades, subject_id,
  unit_price, capacity, season, year, session_dates, is_active, created_at, updated_at
)
select
  o.id, o.school_id, 'koushu', o.formation, o.name, o.target_grades, null,
  o.unit_price, o.capacity, o.season, o.year, o.session_dates, o.is_active,
  o.created_at, o.updated_at
from public.koushu_special_courses o
on conflict (id) do nothing;

-- 講習講座を旧 HAL 形態で作っていた場合、形態を畳んだあとも FK は残るが
-- 座席表タブに出なくなる。プログラミング形態へ寄せておく（該当が無ければ 0 行）。
update public.special_courses
   set formation = 'f_programming'
 where formation = 'f_zrshafsx';

-- koushu_enrollments.course_id の参照先を新テーブルへ張り替える（Web申込は
-- special_courses(scope='koushu') の id を書き込むようになるため）。
-- RESTRICT は踏襲: 申込がある講座は削除できない。
alter table public.koushu_enrollments
  drop constraint if exists koushu_enrollments_course_id_fkey;

alter table public.koushu_enrollments
  add constraint koushu_enrollments_course_id_fkey
  foreign key (course_id) references public.special_courses(id) on delete restrict;

commit;
