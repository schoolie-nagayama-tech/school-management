-- 過去問教材を増やす（2026-10-02）
-- ★志望校過去問（高校受験）749 は指示により従来のまま（5年・①②③なし）。都立(750)・県立(751)も従来のまま。
--  1. 古い年度も使うので、752・753 を 2026〜2017 の10年分にそろえる
--  2. 別の学校の過去問も扱うので、志望校過去問（高校・中学・大学受験）に ②③ を足す
--  3. 753（大学受験）は年度のみの5件だったので、英数国理社 × 10年に作り直す
--
-- ★科目は textbooks.subject ではなく curriculum_items.subject に持たせる
--   （20260921 の方針。1冊に全科目が載る教材なので textbooks.subject は空）。
-- ★753 の旧単元（31344〜31348）は提案書・進行表のどこからも参照されていないことを
--   適用前に確認済み。念のため参照があれば消さない条件も付けてある。

-- 0) 本番には 20260921 に手で足した列がある（リポジトリに作成SQLが無かった）。
--    空のDB（CI・ローカル）でも通るよう、ここで冪等に作っておく。
alter table curriculum_items add column if not exists subject text;

-- 1) 752：科目ごとに足りない年度（2017〜2026）を補う
insert into curriculum_items (textbook_id, sort_order, title, item_type, subject)
select s.textbook_id, 0, s.subject || ' ' || y || '年度', 'lesson', s.subject
from (select distinct textbook_id, subject from curriculum_items
      where textbook_id in (752) and subject is not null) s
cross join generate_series(2017, 2026) as y
where not exists (
  select 1 from curriculum_items c
  where c.textbook_id = s.textbook_id and c.subject = s.subject
    and c.title = s.subject || ' ' || y || '年度'
);

-- 2) 753：旧・年度のみの単元を（未参照なら）消して、5教科 × 10年で作り直す
delete from curriculum_items c
where c.textbook_id = 753 and c.subject is null
  and not exists (select 1 from seasonal_proposal_units u where u.curriculum_item_id = c.id)
  and not exists (select 1 from student_progress p where p.curriculum_item_id = c.id)
  and not exists (select 1 from seasonal_course_curriculum s where s.curriculum_item_id = c.id)
  and not exists (select 1 from test_prep_proposal_units t where t.curriculum_item_id = c.id);

insert into curriculum_items (textbook_id, sort_order, title, item_type, subject)
select 753, 0, s || ' ' || y || '年度', 'lesson', s
from unnest(array['英語', '数学', '国語', '理科', '社会']) as s
cross join generate_series(2017, 2026) as y
where not exists (select 1 from curriculum_items c where c.textbook_id = 753)
  -- ★教材 753 が無いDB（ローカル・CI の新規DB。seed はマイグレーションの後に入る）では
  --   単元が0件なので上の条件が真になり、外部キー違反で落ちる。教材がある時だけ作る。
  --   本番は 753 があるので結果は変わらない（本番には適用済みで、再適用もしない）。
  and exists (select 1 from textbooks t where t.id = 753);

-- 3) 教材名を ① 付きにそろえる（②③ と並べたときに区別できるように）
update textbooks set name = '志望校過去問①（中学受験）' where id = 752;
update textbooks set name = '志望校過去問①（大学受験）' where id = 753;

-- 4) ②③ を ① の複製として作る（教材のみ。単元は次の手順で並べ直しながら複製する）
insert into textbooks (name, publisher, school_type, grade, subject, grade_category, is_active, is_orderable)
select replace(t.name, '①', n.mark), t.publisher, t.school_type, t.grade, t.subject,
       t.grade_category, true, false
from textbooks t
cross join (values ('②'), ('③')) as n(mark)
where t.id in (752, 753)
  and not exists (select 1 from textbooks x where x.name = replace(t.name, '①', n.mark));

insert into curriculum_items (textbook_id, sort_order, title, item_type, subject)
select nt.id, 0, c.title, c.item_type, c.subject
from textbooks nt
join textbooks src on src.name = replace(nt.name, right(left(nt.name, 7), 1), '①')
  and src.id in (752, 753)
join curriculum_items c on c.textbook_id = src.id
where (nt.name like '志望校過去問②%' or nt.name like '志望校過去問③%')
  and not exists (select 1 from curriculum_items x where x.textbook_id = nt.id);

-- 5) sort_order を振り直す：科目が先（英数国理社の順）、その中が年度の新しい順
with ranked as (
  select c.id,
         row_number() over (
           partition by c.textbook_id
           order by coalesce(array_position(array['英語','数学','算数','国語','理科','社会'], c.subject), 99),
                    substring(c.title from '(\d{4})年度')::int desc
         ) as rn
  from curriculum_items c
  join textbooks t on t.id = c.textbook_id
  where t.name like '志望校過去問%' 
)
update curriculum_items c set sort_order = r.rn
from ranked r where r.id = c.id and c.sort_order is distinct from r.rn;
