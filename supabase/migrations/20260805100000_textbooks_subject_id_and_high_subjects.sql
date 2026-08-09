-- 講習申込Web化 Q1: 科目の値空間を1つにする（仕様書 §9-1・決定16・18）
--
-- ★ なぜ必要か:
--   申込（koushu_enrollments.koma_by_subject）は科目を subjects.id（UUID）で持つが、
--   講習提案書は textbooks.subject（自由入力text・FKなし）で持っており、値空間が
--   2つに割れている。「提案書を見せて申込ませる」Web申込フォームはこの突き合わせが
--   前提なので、subjects を唯一の正典にして textbooks から FK で引けるようにする。
--
-- 本番実測（2026-07-28）: textbooks.subject は6値のみで全て subjects.name と一致。
-- (subject, grade_category) で 一意447件 / 90分45分の2候補181件 / 該当なし20件
-- （高校の理科・社会に generic 行が無い＋grade_category NULL 1件）。

-- 1) subjects に高校の generic 理科・社会を追加（決定18）。
--    sort_order は中学の同名行から写す。既にあれば何もしない（再実行安全）。
insert into public.subjects (name, grade_category, duration_minutes, sort_order)
select m.name, 'high', 90, m.sort_order
  from public.subjects m
 where m.grade_category = 'middle'
   and m.name in ('理科', '社会')
   and m.duration_minutes = 90
   and not exists (
     select 1 from public.subjects h
      where h.grade_category = 'high' and h.name = m.name
   );

-- 2) textbooks に subject_id を追加（NULL可。既存の text 列 subject は表示用に残す）
alter table public.textbooks
  add column if not exists subject_id uuid references public.subjects(id);

comment on column public.textbooks.subject_id is
  '科目の正典参照（subjects.id）。text列 subject は表示用に残置。新規ロジックはこちらを使う（仕様書§9-1）';

create index if not exists idx_textbooks_subject_id on public.textbooks(subject_id);

-- 3) バックフィル: (subject, grade_category) → subjects(name, grade_category, 90分) で解決。
--    45分の科目行には寄せない（教材は内容の単位であり授業長ではない。仕様書§9-1）。
--    grade_category が NULL の行はここでは解決されず NULL のまま残る（後で手当て）。
update public.textbooks t
   set subject_id = s.id
  from public.subjects s
 where t.subject_id is null
   and s.name = t.subject
   and s.grade_category = t.grade_category
   and s.duration_minutes = 90;
