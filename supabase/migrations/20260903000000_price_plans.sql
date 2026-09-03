-- ============================================================
-- 料金マスタ（price_plans / price_plan_items）
-- ============================================================
-- 背景:
--   単価が4箇所に散らばっていて正典が無かった。
--     - form_periods.settings.price_table（増コマ。期間ごとにコピー）
--     - コードのハードコード（GradePriceEditor / ZoukomaForm）
--     - course_prep_periods.apply_price_table（講習。実教室は未設定）
--     - special_courses.unit_price（講座ごと。永山は未設定）
--   改定のたびに全部を手で追う必要があり、実際 2026-09 改定で増コマが旧単価のまま残った。
--
-- 方針:
--   ★ このテーブルは「配布元」。請求が確定した過去分まで書き換えないため、
--     期間や申込に配ったあとの金額は従来どおりスナップショットで残す
--     （form_periods.settings.price_table などはそのまま）。
--     マスタを直しても過去の請求額は動かない。
--   ★ 版は effective_from で持つ。改定のたびに新しい plan を1行足す。
--     過去の plan は消さない（当時いくらだったかを引けるようにするため）。
--   ★ 料金は全教室共通（2026-09時点。教室別が要るようになったら school_id を足す）。
--
-- 学年は数値で持つ（小1=1 … 小6=6 / 中1=7 … 中3=9 / 高1=10 … 高3=12、年長=0）。
-- ラベルの表記ゆれで引き当てが外れるのを避けるため、帯は grade_min〜grade_max で表す。
-- ============================================================

create table if not exists public.price_plans (
  id uuid primary key default gen_random_uuid(),
  -- 料金表に印字されているコード（例 '202609A'）。改定の識別子として使う
  code text not null unique,
  name text not null,
  -- この料金が適用され始める日
  effective_from date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.price_plans is '料金表の版。改定のたびに1行増やす。過去の版は消さない（当時の金額を引くため）。';

create table if not exists public.price_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.price_plans(id) on delete cascade,
  -- monthly=個別の月謝 / per_koma=個別の追加授業(単コマ)
  -- group_monthly=小集団の月謝 / group_set=小集団の特別セット / group_per_koma=小集団の追加授業
  -- combo_set=個別＋小集団のセット月謝 / course_monthly=通年講座の月額(HAL・YSG)
  kind text not null check (
    kind in ('monthly','per_koma','group_monthly','group_set','group_per_koma','combo_set','course_monthly')
  ),
  -- 対象学年の帯（両端を含む）
  grade_min smallint not null,
  grade_max smallint not null,
  -- 1コマの分数。45/50/60/80/90。学年で決まるので monthly/per_koma では必須に近い
  duration_minutes smallint,
  -- 指導形態。1=1対1(PS1) / 2=1対2(PS2)。個別のみ
  ratio smallint check (ratio in (1,2)),
  -- 週回数。monthly のみ 1〜5
  weekly_count smallint check (weekly_count between 1 and 5),
  -- 科目数。小集団のみ
  subject_count smallint,
  -- 上記の軸で表せない区分（セット料金の組み合わせ・講座名など）
  variant text,
  -- 税込金額（円）
  amount integer not null check (amount >= 0),
  note text,
  created_at timestamptz not null default now()
);

comment on table public.price_plan_items is '料金表の明細。学年帯×形態×分数×週回数などの軸で1行1金額。';

-- 同じ条件の行が二重に入らないようにする（null 同士も同一とみなす）
create unique index if not exists idx_price_plan_items_unique
  on public.price_plan_items (
    plan_id, kind, grade_min, grade_max,
    coalesce(duration_minutes, -1), coalesce(ratio, -1),
    coalesce(weekly_count, -1), coalesce(subject_count, -1), coalesce(variant, '')
  );

create index if not exists idx_price_plan_items_lookup
  on public.price_plan_items (plan_id, kind, grade_min, grade_max);

alter table public.price_plans enable row level security;
alter table public.price_plan_items enable row level security;

-- 参照は認証済みなら全員（保護者ポータルの見積りでも使う想定）。
-- 更新はアプリからは行わない（改定は移行スクリプトで入れる）ので、書き込みポリシーは作らない。
drop policy if exists price_plans_select on public.price_plans;
create policy price_plans_select on public.price_plans for select to authenticated using (true);

drop policy if exists price_plan_items_select on public.price_plan_items;
create policy price_plan_items_select on public.price_plan_items for select to authenticated using (true);

-- ============================================================
-- 2026年9月改定（【FCIE】2609改定_新A料金表）
-- ============================================================
insert into public.price_plans (code, name, effective_from, note)
values ('202609A', '新A料金表（2026年9月改定）', '2026-09-01', '出典: 【FCIE】2609改定_新A料金表。税込。全教室共通。')
on conflict (code) do nothing;

insert into public.price_plan_items
  (plan_id, kind, grade_min, grade_max, duration_minutes, ratio, weekly_count, subject_count, variant, amount)
select p.id, x.kind, x.grade_min, x.grade_max, x.duration_minutes, x.ratio, x.weekly_count, x.subject_count, x.variant, x.amount
from public.price_plans p
cross join (values
  ('monthly', 1, 4, 45, 2, 1, null, null, 8910),
  ('monthly', 1, 4, 45, 2, 2, null, null, 17820),
  ('monthly', 1, 4, 45, 2, 3, null, null, 26730),
  ('monthly', 1, 4, 45, 2, 4, null, null, 35640),
  ('monthly', 1, 4, 45, 2, 5, null, null, 44550),
  ('per_koma', 1, 4, 45, 2, null, null, null, 2230),
  ('monthly', 1, 4, 45, 1, 1, null, null, 11440),
  ('monthly', 1, 4, 45, 1, 2, null, null, 22870),
  ('monthly', 1, 4, 45, 1, 3, null, null, 34310),
  ('monthly', 1, 4, 45, 1, 4, null, null, 45740),
  ('monthly', 1, 4, 45, 1, 5, null, null, 57180),
  ('per_koma', 1, 4, 45, 1, null, null, null, 2860),
  ('monthly', 5, 5, 60, 2, 1, null, null, 11870),
  ('monthly', 5, 5, 60, 2, 2, null, null, 23720),
  ('monthly', 5, 5, 60, 2, 3, null, null, 35580),
  ('monthly', 5, 5, 60, 2, 4, null, null, 47450),
  ('monthly', 5, 5, 60, 2, 5, null, null, 59290),
  ('per_koma', 5, 5, 60, 2, null, null, null, 2970),
  ('monthly', 5, 5, 60, 1, 1, null, null, 15250),
  ('monthly', 5, 5, 60, 1, 2, null, null, 30500),
  ('monthly', 5, 5, 60, 1, 3, null, null, 45740),
  ('monthly', 5, 5, 60, 1, 4, null, null, 60990),
  ('monthly', 5, 5, 60, 1, 5, null, null, 76230),
  ('per_koma', 5, 5, 60, 1, null, null, null, 3820),
  ('monthly', 6, 6, 60, 2, 1, null, null, 12360),
  ('monthly', 6, 6, 60, 2, 2, null, null, 24690),
  ('monthly', 6, 6, 60, 2, 3, null, null, 37030),
  ('monthly', 6, 6, 60, 2, 4, null, null, 49380),
  ('monthly', 6, 6, 60, 2, 5, null, null, 61730),
  ('per_koma', 6, 6, 60, 2, null, null, null, 3100),
  ('monthly', 6, 6, 60, 1, 1, null, null, 16160),
  ('monthly', 6, 6, 60, 1, 2, null, null, 32310),
  ('monthly', 6, 6, 60, 1, 3, null, null, 48470),
  ('monthly', 6, 6, 60, 1, 4, null, null, 64630),
  ('monthly', 6, 6, 60, 1, 5, null, null, 80780),
  ('per_koma', 6, 6, 60, 1, null, null, null, 4050),
  ('monthly', 1, 5, 90, 2, 1, null, null, 17790),
  ('monthly', 1, 5, 90, 2, 2, null, null, 32430),
  ('monthly', 1, 5, 90, 2, 3, null, null, 47050),
  ('monthly', 1, 5, 90, 2, 4, null, null, 62250),
  ('monthly', 1, 5, 90, 2, 5, null, null, 77460),
  ('per_koma', 1, 5, 90, 2, null, null, null, 4060),
  ('monthly', 1, 5, 90, 1, 1, null, null, 22870),
  ('monthly', 1, 5, 90, 1, 2, null, null, 42600),
  ('monthly', 1, 5, 90, 1, 3, null, null, 62300),
  ('monthly', 1, 5, 90, 1, 4, null, null, 82580),
  ('monthly', 1, 5, 90, 1, 5, null, null, 102980),
  ('per_koma', 1, 5, 90, 1, null, null, null, 5340),
  ('monthly', 6, 6, 90, 2, 1, null, null, 18450),
  ('monthly', 6, 6, 90, 2, 2, null, null, 33700),
  ('monthly', 6, 6, 90, 2, 3, null, null, 48940),
  ('monthly', 6, 6, 90, 2, 4, null, null, 64770),
  ('monthly', 6, 6, 90, 2, 5, null, null, 80710),
  ('per_koma', 6, 6, 90, 2, null, null, null, 4220),
  ('monthly', 6, 6, 90, 1, 1, null, null, 24160),
  ('monthly', 6, 6, 90, 1, 2, null, null, 45120),
  ('monthly', 6, 6, 90, 1, 3, null, null, 66070),
  ('monthly', 6, 6, 90, 1, 4, null, null, 87710),
  ('monthly', 6, 6, 90, 1, 5, null, null, 109270),
  ('per_koma', 6, 6, 90, 1, null, null, null, 5650),
  ('monthly', 7, 8, 90, 2, 1, null, null, 19080),
  ('monthly', 7, 8, 90, 2, 2, null, null, 34950),
  ('monthly', 7, 8, 90, 2, 3, null, null, 50820),
  ('monthly', 7, 8, 90, 2, 4, null, null, 67380),
  ('monthly', 7, 8, 90, 2, 5, null, null, 83860),
  ('per_koma', 7, 8, 90, 2, null, null, null, 4380),
  ('monthly', 7, 8, 90, 1, 1, null, null, 25410),
  ('monthly', 7, 8, 90, 1, 2, null, null, 47680),
  ('monthly', 7, 8, 90, 1, 3, null, null, 69920),
  ('monthly', 7, 8, 90, 1, 4, null, null, 92750),
  ('monthly', 7, 8, 90, 1, 5, null, null, 115680),
  ('per_koma', 7, 8, 90, 1, null, null, null, 5970),
  ('monthly', 9, 9, 90, 2, 1, null, null, 19710),
  ('monthly', 9, 9, 90, 2, 2, null, null, 36260),
  ('monthly', 9, 9, 90, 2, 3, null, null, 52790),
  ('monthly', 9, 9, 90, 2, 4, null, null, 69900),
  ('monthly', 9, 9, 90, 2, 5, null, null, 87010),
  ('per_koma', 9, 9, 90, 2, null, null, null, 4540),
  ('monthly', 9, 9, 90, 1, 1, null, null, 26700),
  ('monthly', 9, 9, 90, 1, 2, null, null, 50200),
  ('monthly', 9, 9, 90, 1, 3, null, null, 73690),
  ('monthly', 9, 9, 90, 1, 4, null, null, 97870),
  ('monthly', 9, 9, 90, 1, 5, null, null, 121970),
  ('per_koma', 9, 9, 90, 1, null, null, null, 6290),
  ('monthly', 10, 10, 90, 2, 1, null, null, 20990),
  ('monthly', 10, 10, 90, 2, 2, null, null, 39410),
  ('monthly', 10, 10, 90, 2, 3, null, null, 59110),
  ('monthly', 10, 10, 90, 2, 4, null, null, 78810),
  ('monthly', 10, 10, 90, 2, 5, null, null, 98500),
  ('per_koma', 10, 10, 90, 2, null, null, null, 4930),
  ('monthly', 10, 10, 90, 1, 1, null, null, 28620),
  ('monthly', 10, 10, 90, 1, 2, null, null, 55910),
  ('monthly', 10, 10, 90, 1, 3, null, null, 83860),
  ('monthly', 10, 10, 90, 1, 4, null, null, 111810),
  ('monthly', 10, 10, 90, 1, 5, null, null, 139760),
  ('per_koma', 10, 10, 90, 1, null, null, null, 7000),
  ('monthly', 11, 11, 90, 2, 1, null, null, 22250),
  ('monthly', 11, 11, 90, 2, 2, null, null, 41970),
  ('monthly', 11, 11, 90, 2, 3, null, null, 62960),
  ('monthly', 11, 11, 90, 2, 4, null, null, 83930),
  ('monthly', 11, 11, 90, 2, 5, null, null, 104920),
  ('per_koma', 11, 11, 90, 2, null, null, null, 5250),
  ('monthly', 11, 11, 90, 1, 1, null, null, 29870),
  ('monthly', 11, 11, 90, 1, 2, null, null, 58480),
  ('monthly', 11, 11, 90, 1, 3, null, null, 87710),
  ('monthly', 11, 11, 90, 1, 4, null, null, 116950),
  ('monthly', 11, 11, 90, 1, 5, null, null, 146170),
  ('per_koma', 11, 11, 90, 1, null, null, null, 7320),
  ('monthly', 12, 12, 90, 2, 1, null, null, 23530),
  ('monthly', 12, 12, 90, 2, 2, null, null, 44490),
  ('monthly', 12, 12, 90, 2, 3, null, null, 66730),
  ('monthly', 12, 12, 90, 2, 4, null, null, 88970),
  ('monthly', 12, 12, 90, 2, 5, null, null, 111200),
  ('per_koma', 12, 12, 90, 2, null, null, null, 5570),
  ('monthly', 12, 12, 90, 1, 1, null, null, 31130),
  ('monthly', 12, 12, 90, 1, 2, null, null, 60990),
  ('monthly', 12, 12, 90, 1, 3, null, null, 91480),
  ('monthly', 12, 12, 90, 1, 4, null, null, 121970),
  ('monthly', 12, 12, 90, 1, 5, null, null, 152460),
  ('per_koma', 12, 12, 90, 1, null, null, null, 7630),
  ('group_monthly', 7, 8, null, null, null, 1, null, 4080),
  ('group_monthly', 7, 8, null, null, null, 2, null, 8160),
  ('group_monthly', 7, 8, null, null, null, 3, null, 12240),
  ('group_set', 7, 8, null, null, null, 2, null, 6050),
  ('group_set', 7, 8, null, null, null, 3, null, 9700),
  ('group_per_koma', 7, 8, null, null, null, null, null, 1020),
  ('group_monthly', 9, 9, null, null, null, 1, null, 5120),
  ('group_monthly', 9, 9, null, null, null, 2, null, 10240),
  ('group_monthly', 9, 9, null, null, null, 3, null, 15360),
  ('group_set', 9, 9, null, null, null, 2, null, 7280),
  ('group_set', 9, 9, null, null, null, 3, null, 12100),
  ('group_per_koma', 9, 9, null, null, null, null, null, 1280),
  ('combo_set', 7, 8, null, null, null, null, '個別(英数)+小集団(理社)', 43110),
  ('combo_set', 7, 8, null, null, null, null, '個別(英数)+小集団(国理社)', 44650),
  ('combo_set', 7, 8, null, null, null, null, '個別(3科)+小集団(国理社から2科)', 56870),
  ('combo_set', 9, 9, null, null, null, null, '個別(英数)+小集団(理社)', 46500),
  ('combo_set', 9, 9, null, null, null, null, '個別(英数)+小集団(国理社)', 48360),
  ('combo_set', 9, 9, null, null, null, null, '個別(3科)+小集団(国理社から2科)', 60070),
  ('course_monthly', 0, 6, 50, null, null, null, 'HAL50分', 10890),
  ('course_monthly', 7, 9, 80, null, null, null, 'HAL80分', 11990),
  ('course_monthly', 10, 12, null, null, null, null, 'YSG(個別あり)', 990),
  ('course_monthly', 10, 12, null, null, null, null, 'YSG(個別なし)', 1980)
) as x(kind, grade_min, grade_max, duration_minutes, ratio, weekly_count, subject_count, variant, amount)
where p.code = '202609A'
on conflict do nothing;
