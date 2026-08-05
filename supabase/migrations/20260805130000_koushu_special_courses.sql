-- 特別講座（小集団・HAL 等）のマスタ（仕様書 §18・決定55〜58）
--
-- ★ なぜ新テーブルか:
--   seasonal_courses(959件) は「個別指導の学習メニュー」で開催日時を持たず、
--   seasonal_course_applications に592件の現役申込がある。特別講座は
--   「開催日時が固定で配布する講座」で列も用途も別物。同居させると既存コード
--   全部に「メニューか講座か」の分岐が入るため分離する。

create table if not exists public.koushu_special_courses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  season text not null,
  year integer not null,
  formation text not null references public.schedule_formations(key) on delete restrict,
  name text not null,
  target_grades integer[] not null default '{}',
  unit_price integer,
  session_dates jsonb not null default '[]',
  capacity integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_koushu_special_courses_period
  on public.koushu_special_courses (school_id, season, year, is_active);

comment on table public.koushu_special_courses is
  '特別講座（小集団・HAL 等）。固定開催・振替不可。seasonal_courses(個別メニュー)とは別物（仕様書§18）';

alter table public.koushu_special_courses enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'koushu_special_courses'
       and policyname = 'koushu_special_courses_school_scope'
  ) then
    create policy koushu_special_courses_school_scope
      on public.koushu_special_courses for all to authenticated
      using (check_school_access(school_id))
      with check (check_school_access(school_id));
  end if;
end $$;

revoke all on public.koushu_special_courses from anon;

drop trigger if exists koushu_special_courses_set_updated_at on public.koushu_special_courses;
create trigger koushu_special_courses_set_updated_at
before update on public.koushu_special_courses
for each row execute function public.update_updated_at_column();

-- koushu_enrollments.course_id の参照先を特別講座へ張り替え（§18-4）。
-- 旧FKは seasonal_courses(id) を CASCADE で参照していた（講座削除で申込が
-- 道連れに消える）。新FKは RESTRICT にして、申込がある講座を消せないようにする。
-- 本番は koushu_enrollments 0行なのでデータ移行は不要。
alter table public.koushu_enrollments
  drop constraint if exists koushu_enrollments_course_id_fkey;

alter table public.koushu_enrollments
  add constraint koushu_enrollments_course_id_fkey
  foreign key (course_id) references public.koushu_special_courses(id) on delete restrict;
