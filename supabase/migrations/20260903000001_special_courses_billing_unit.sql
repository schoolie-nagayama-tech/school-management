-- ============================================================
-- 受講料の数え方を講座ごとに持つ（special_courses.billing_unit）
-- ============================================================
-- 背景:
--   通年講座の請求は「単価 × その月の実施回数」で計算している。
--   ところが HAL は月額固定（年長〜小学生50分=10,890円 / 中学生80分=11,990円）で、
--   月額を1回単価として入れると月4〜5回ぶん掛かって4〜5倍請求になる。
--   そのため HAL の単価は空のまま運用され、請求に載っていなかった。
--
-- 設計:
--   既定は per_session（従来どおり 単価×回数）。月謝制の講座だけ monthly にする。
--   講習講座は申込コマ数で請求するので常に per_session。
--   ★ 他の通年講座（小集団の国理社など）は従来どおり回数×単価のまま。
-- 冪等: IF NOT EXISTS。UPDATE も同じ値を入れ直すだけ。
-- ============================================================

alter table public.special_courses
  add column if not exists billing_unit text not null default 'per_session'
  check (billing_unit in ('per_session','monthly'));

comment on column public.special_courses.billing_unit is
  '受講料の数え方。per_session=1回ごと（単価×回数）／monthly=月額（回数によらず一定）。HALのような月謝制の講座に monthly を使う。';

-- HAL は月額。金額は料金表 202609A に合わせる。
update public.special_courses
set billing_unit = 'monthly',
    unit_price = case when name = 'HAL50分' then 10890 when name = 'HAL80分' then 11990 else unit_price end
where scope = 'year_round' and name in ('HAL50分','HAL80分');
