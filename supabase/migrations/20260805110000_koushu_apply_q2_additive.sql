-- 講習申込Web化 Q2（追加のみ）: 提案・期間・コース・トークン
-- 仕様書 §9-4 / §16-1 / §16-3 / §16-4 / §17-3
--
-- ★ この移行は全て「列追加」と「新規テーブル」だけで、削除・型変更・データ書き換えは無い。
--   既存の読み書きは壊れない。unique の張り替え（複数コース参加）は
--   upsertKoushuEnrollment の onConflict と対なので別マイグレに分ける。

-- ------------------------------------------------------------------
-- 1) 提案テーブルに ratio/duration/half_position（§9-4・既存バグの是正）
--    schedule_entries には既にこの3列があるのに publishProposal の INSERT に
--    含まれておらず、公開時に必ず既定値で書かれていた。まず器を用意する。
-- ------------------------------------------------------------------
alter table public.schedule_match_proposals
  add column if not exists ratio smallint not null default 2,
  add column if not exists duration_minutes integer,
  add column if not exists half_position text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'schedule_match_proposals_ratio_check') then
    alter table public.schedule_match_proposals
      add constraint schedule_match_proposals_ratio_check check (ratio in (1, 2));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'schedule_match_proposals_duration_check') then
    alter table public.schedule_match_proposals
      add constraint schedule_match_proposals_duration_check
      check (duration_minutes is null or duration_minutes in (45, 90));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'schedule_match_proposals_half_position_check') then
    alter table public.schedule_match_proposals
      add constraint schedule_match_proposals_half_position_check
      check (half_position is null or half_position in ('first', 'second'));
  end if;
end $$;

-- ------------------------------------------------------------------
-- 2) 講習提案書に授業形式（§16-3・決定14の実装先）
--    形式は教室が提案時に決める。保護者フォームは読み取り専用で表示する。
-- ------------------------------------------------------------------
alter table public.seasonal_proposals
  add column if not exists ratio smallint not null default 2,
  add column if not exists duration_minutes integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'seasonal_proposals_ratio_check') then
    alter table public.seasonal_proposals
      add constraint seasonal_proposals_ratio_check check (ratio in (1, 2));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'seasonal_proposals_duration_check') then
    alter table public.seasonal_proposals
      add constraint seasonal_proposals_duration_check
      check (duration_minutes is null or duration_minutes in (45, 90));
  end if;
end $$;

comment on column public.seasonal_proposals.duration_minutes is
  'NULL = subjects.duration_minutes の既定に従う。45は小1〜小4のみ（決定17）';

-- ------------------------------------------------------------------
-- 3) 講習期間に 申込の公開期間・単価表・学年別終了日
--    （§16-1 決定29 / §17-2 決定44）
--    form_periods には載せない（form_type を増やさない＝決定20）ので、
--    講習期間の正典であるこのテーブルに集約する。
-- ------------------------------------------------------------------
alter table public.course_prep_periods
  add column if not exists apply_publish_start timestamptz,
  add column if not exists apply_publish_end timestamptz,
  add column if not exists apply_price_table jsonb,
  add column if not exists schedule_end_by_grade jsonb;

comment on column public.course_prep_periods.apply_publish_start is
  'NULL = 申込フォーム未公開。2027-02の切替まで NULL のまま（決定22・§12の非公開担保）';
comment on column public.course_prep_periods.apply_price_table is
  '学年 → 形式(1on1/1on2) → 時間(45/90) → 円 の3軸単価表（決定26・§15-2）';
comment on column public.course_prep_periods.schedule_end_by_grade is
  '学年(1-13) → 終了日 の上書き。開始は共通、未設定の学年は schedule_end_date（決定44）';

-- ------------------------------------------------------------------
-- 4) コース（小集団・プログラミング）に 開催予定と単価（§17-3 決定40・42）
-- ------------------------------------------------------------------
alter table public.seasonal_courses
  add column if not exists session_dates jsonb,
  add column if not exists unit_price integer;

comment on column public.seasonal_courses.session_dates is
  '[{date, start_time, end_time}] 配布する開催予定表そのもの。回数=件数（決定40）';
comment on column public.seasonal_courses.unit_price is
  '1回あたりの円（税込）。料金 = unit_price × 参加回数（決定42）';

-- ------------------------------------------------------------------
-- 5) 申込フォームのトークン（§16-4 決定19）
--    スコープは 生徒 × 講習期間（提案書1枚ごとではない）。
--    失効は revoked_at、再発行は新しい行を作る。
-- ------------------------------------------------------------------
create table if not exists public.koushu_apply_tokens (
  token text primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  season text not null,
  year integer not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_koushu_apply_tokens_student
  on public.koushu_apply_tokens (school_id, season, year, student_id);

-- RLS: 既定権限で anon/authenticated に ALL が付く既知の罠があるため必ず有効化する。
-- 公開フォームからの参照は service role 専用APIを通す想定なので、
-- ここでは教室スタッフ（教室スコープ）の参照のみ許可する。
alter table public.koushu_apply_tokens enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'koushu_apply_tokens'
       and policyname = 'koushu_apply_tokens_school_scope'
  ) then
    create policy koushu_apply_tokens_school_scope
      on public.koushu_apply_tokens
      for all
      to authenticated
      using (check_school_access(school_id))
      with check (check_school_access(school_id));
  end if;
end $$;

revoke all on public.koushu_apply_tokens from anon;
